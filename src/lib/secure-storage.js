// Android-only encrypted storage. Must initialise BEFORE the app's stores import.
// The browser/PWA retains its existing localStorage persistence, with no Keystore claim.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { migrateSecureEntries } from './secure-migration.js';

const KEYS = new Set(['account', 'abs', 'debrid', 'hardcover', 'qbit', 'ai']);
const android = Capacitor.isNativePlatform();
const Native = registerPlugin('InkwellSecureStore');
const snapshot = new Map();
const pending = new Map();
let ready = false;

export const isSecureStore = (key) => android && KEYS.has(key);

export async function initialiseSecureStorage() {
  if (!android) {
    ready = true;
    return;
  }
  if (!Capacitor.isPluginAvailable('InkwellSecureStore')) {
    throw new Error('The Android encrypted storage plugin is missing from this build');
  }
  const { items = {} } = await Native.getAll();
  const migrated = await migrateSecureEntries({
    keys: KEYS,
    items,
    storage: localStorage,
    write: (key, value) => Native.put({ key, value }),
  });
  for (const [key, value] of migrated) snapshot.set(key, value);
  ready = true;
}

export function initialSecureValue(key) {
  if (!isSecureStore(key)) return null;
  if (!ready) throw new Error('Secure storage was read before initialization');
  return snapshot.get(key) ?? null;
}

export function saveSecureValue(key, value) {
  if (!isSecureStore(key) || !ready) throw new Error('Secure storage is unavailable');
  // Serialize updates per store; no older async write can overwrite a newer one.
  const next = (pending.get(key) || Promise.resolve())
    .catch(() => {})
    .then(() => Native.put({ key, value }))
    .then(() => snapshot.set(key, value));
  pending.set(key, next);
  next.catch(() => window.dispatchEvent(new CustomEvent('audiohub:secure-storage-error', { detail: { key } })));
  return next;
}
