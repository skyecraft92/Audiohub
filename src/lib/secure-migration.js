// Framework-independent migration logic, covered by Node tests.
// A failed encrypted write must NEVER remove the last plaintext copy.
export async function migrateSecureEntries({ keys, items, storage, write }) {
  const snapshot = new Map();
  for (const key of keys) {
    const oldKey = 'inkwell:' + key;
    const legacy = storage.getItem(oldKey);
    const encrypted = Object.prototype.hasOwnProperty.call(items, key) ? items[key] : undefined;
    if (encrypted !== undefined) {
      JSON.parse(encrypted); // Invalid encrypted snapshots are fatal, not reset.
      snapshot.set(key, encrypted); // Device vault is authoritative after migration.
    } else if (legacy !== null) {
      JSON.parse(legacy);
      await write(key, legacy); // Native plug-in encrypts & verifies before resolving.
      snapshot.set(key, legacy);
    }
    if (legacy !== null) storage.removeItem(oldKey);
  }
  return snapshot;
}
