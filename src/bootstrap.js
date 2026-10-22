// Do not evaluate app modules (which create persistent stores) until Android's
// encrypted credentials have been loaded and legacy plaintext has been migrated.
import { initialiseSecureStorage } from './lib/secure-storage.js';

window.addEventListener('audiohub:secure-storage-error', () => {
  alert('Audiohub could not save encrypted credentials. Do not log out or uninstall. Check device storage and restart the app.');
});

try {
  await initialiseSecureStorage();
  await import('./main.jsx');
} catch (error) {
  console.error('Audiohub secure startup failed:', error?.message || error);
  const root = document.getElementById('app');
  if (root) {
    root.setAttribute('role', 'alert');
    root.style.cssText = 'color:#fff;background:#101012;font:16px sans-serif;padding:24px;min-height:100vh';
    root.textContent = 'Cannot unlock secure app data. Your saved credentials have NOT been erased. Close and reopen Audiohub; if it persists, report the storage error before clearing app data. ' + (error?.message || 'Unknown error');
  }
}
