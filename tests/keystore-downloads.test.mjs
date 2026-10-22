import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { migrateSecureEntries } from '../src/lib/secure-migration.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function fakeStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return {
    m,
    getItem: (key) => m.has(key) ? m.get(key) : null,
    removeItem: (key) => m.delete(key),
  };
}

test('plaintext legacy values are encrypted before removal', async () => {
  const storage = fakeStorage({ 'inkwell:debrid': '{"torbox":"private-key"}' });
  const writes = [];
  const result = await migrateSecureEntries({
    keys: ['debrid'], items: {}, storage,
    write: async (key, value) => {
      assert.equal(storage.getItem('inkwell:debrid'), value);
      writes.push([key, value]);
    },
  });
  assert.deepEqual(writes, [['debrid', '{"torbox":"private-key"}']]);
  assert.equal(storage.getItem('inkwell:debrid'), null);
  assert.equal(result.get('debrid'), '{"torbox":"private-key"}');
});

test('a failed encrypted write preserves the last plaintext copy', async () => {
  const storage = fakeStorage({ 'inkwell:account': '{"refreshToken":"important"}' });
  await assert.rejects(migrateSecureEntries({
    keys: ['account'], items: {}, storage,
    write: async () => { throw new Error('Keystore unavailable'); },
  }), /Keystore unavailable/);
  assert.equal(storage.getItem('inkwell:account'), '{"refreshToken":"important"}');
});

test('encrypted values remain authoritative on an interrupted upgrade', async () => {
  const storage = fakeStorage({ 'inkwell:debrid': '{"torbox":"old"}' });
  const result = await migrateSecureEntries({
    keys: ['debrid'], items: { debrid: '{"torbox":"new"}' }, storage,
    write: async () => { throw new Error('must not rewrite vault'); },
  });
  assert.equal(result.get('debrid'), '{"torbox":"new"}');
  assert.equal(storage.getItem('inkwell:debrid'), null);
});

test('corrupt encrypted snapshots fail closed without deleting plaintext', async () => {
  const storage = fakeStorage({ 'inkwell:ai': '{"groqKey":"old"}' });
  await assert.rejects(migrateSecureEntries({
    keys: ['ai'], items: { ai: '{not-json' }, storage, write: async () => {},
  }), SyntaxError);
  assert.equal(storage.getItem('inkwell:ai'), '{"groqKey":"old"}');
});

test('native startup unlocks the vault before loading persistent stores', () => {
  const index = read('../index.html');
  const boot = read('../src/bootstrap.js');
  const store = read('../src/lib/store.js');
  assert.match(index, /src\/bootstrap\.js/);
  assert.ok(boot.indexOf('await initialiseSecureStorage()') < boot.indexOf("await import('./main.jsx')"));
  assert.match(store, /secure \? initialSecureValue\(key\) : localStorage\.getItem/);
  assert.match(store, /if \(secure\) throw err/);
  assert.match(store, /saveSecureValue\(key, text\)/);
});

test('native vault is AES-GCM Keystore bound and backup excluded', () => {
  const java = read('../android/app/src/main/java/app/inkwell/books/InkwellSecureStorePlugin.java');
  const main = read('../android/app/src/main/java/app/inkwell/books/MainActivity.java');
  assert.match(java, /AndroidKeyStore/);
  assert.match(java, /AES\/GCM\/NoPadding/);
  assert.match(java, /setKeySize\(256\)/);
  assert.match(java, /getNoBackupFilesDir\(\)/);
  assert.match(java, /AtomicFile/);
  assert.match(java, /value\.equals\(read\(key\)\)/);
  assert.match(main, /registerPlugin\(InkwellSecureStorePlugin\.class\)/);
});

test('download retry verifies old files and refreshes an expired cloud URL once', () => {
  const js = read('../src/lib/downloads.js');
  const java = read('../android/app/src/main/java/app/inkwell/books/InkwellDownloadsPlugin.java');
  assert.match(js, /Native\.exists\(\{ uri: old\.uri \}\)/);
  assert.match(js, /savedPrefix\(previous, tracks, folder, target\)/);
  assert.match(js, /url = await t\.resolve\(\)/);
  assert.match(js, /status: 'error', error: 'Interrupted/);
  assert.match(java, /public void exists\(PluginCall call\)/);
});
