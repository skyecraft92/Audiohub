package app.inkwell.books;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Store credential-bearing JSON snapshots as AES-256-GCM encrypted files.
 * The encryption key remains in Android Keystore and the ciphertext is stored
 * under noBackupFilesDir (it must not be restored without its device key).
 * No plaintext values, keys or ciphertext are written to application logs.
 */
@CapacitorPlugin(name = "InkwellSecureStore")
public class InkwellSecureStorePlugin extends Plugin {
    private static final String KEY_ALIAS = "audiohub.secure-storage.v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final Set<String> ALLOWED = new HashSet<>(Arrays.asList(
            "account", "abs", "debrid", "hardcover", "qbit", "ai"
    ));

    private File directory() throws Exception {
        File dir = new File(getContext().getNoBackupFilesDir(), "audiohub-secure-v1");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("Secure data directory unavailable");
        return dir;
    }

    private AtomicFile file(String key) throws Exception {
        if (!ALLOWED.contains(key)) throw new IllegalArgumentException("Unknown secure store");
        return new AtomicFile(new File(directory(), key + ".vault"));
    }

    private SecretKey secretKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return (SecretKey) store.getKey(KEY_ALIAS, null);
        }
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .setKeySize(256)
                .build());
        return gen.generateKey();
    }

    private String encrypt(String cleartext) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] iv = cipher.getIV();
        byte[] encoded = cipher.doFinal(cleartext.getBytes(StandardCharsets.UTF_8));
        return "v1." + Base64.encodeToString(iv, Base64.NO_WRAP) + "."
                + Base64.encodeToString(encoded, Base64.NO_WRAP);
    }

    private String decrypt(String stored) throws Exception {
        String[] parts = stored.split("\\.", -1);
        if (parts.length != 3 || !"v1".equals(parts[0])) throw new Exception("Unrecognised secure storage format");
        byte[] iv = Base64.decode(parts[1], Base64.NO_WRAP);
        if (iv.length != 12) throw new Exception("Invalid secure storage nonce");
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(Base64.decode(parts[2], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private String read(String key) throws Exception {
        AtomicFile file = file(key);
        if (!file.getBaseFile().exists()) return null;
        return decrypt(new String(file.readFully(), StandardCharsets.UTF_8));
    }

    @PluginMethod
    public void getAll(PluginCall call) {
        getBridge().execute(() -> {
            try {
                JSObject items = new JSObject();
                for (String key : ALLOWED) {
                    String value = read(key);
                    if (value != null) items.put(key, value);
                }
                JSObject result = new JSObject();
                result.put("items", items);
                call.resolve(result);
            } catch (Exception ex) {
                // Fail closed. Never discard unreadable encrypted files.
                call.reject("Could not unlock encrypted storage: " + ex.getClass().getSimpleName());
            }
        });
    }

    @PluginMethod
    public void put(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || !ALLOWED.contains(key) || value == null) {
            call.reject("Invalid secure store write");
            return;
        }
        getBridge().execute(() -> {
            FileOutputStream stream = null;
            try {
                AtomicFile target = file(key);
                byte[] encrypted = encrypt(value).getBytes(StandardCharsets.UTF_8);
                stream = target.startWrite();
                stream.write(encrypted);
                target.finishWrite(stream);
                stream = null;
                // Verify a successful decrypt before acknowledging the write.
                if (!value.equals(read(key))) throw new Exception("Secure write verification failed");
                call.resolve();
            } catch (Exception ex) {
                if (stream != null) {
                    try { file(key).failWrite(stream); } catch (Exception ignored) {}
                }
                call.reject("Encrypted storage write failed: " + ex.getClass().getSimpleName());
            }
        });
    }
}
