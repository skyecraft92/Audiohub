// Android-only encrypted storage. Must initialise BEFORE the app's stores import.
// The browser/PWA retains its existing localStorage persistence, with no Keystore claim.
import { Capacitor, registerPlugin } from '@capacitor/core';

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
  for (const key of KEYS) {
    const oldKey = 'inkwell:' + key;
    const legacy = localStorage.getItem(oldKey);
    const encrypted = Object.prototype.hasOwnProperty.call(items, key) ? items[key] : undefined;

    if (encrypted !== undefined) {
      // If a previous upgrade was interrupted, encrypted data takes precedence.
      JSON.parse(encrypted);
      snapshot.set(key, encrypted);
    } else if (legacy !== null) {
      // Do not remove a plaintext copy until native encryption has succeeded.
      JSON.parse(legacy);
      await Native.put({ key, value: legacy });
      snapshot.set(key, legacy);
    }
    // Also remove a stale legacy copy if secure data was already present.
    if (legacy !== null) localStorage.removeItem(oldKey);
  }
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
