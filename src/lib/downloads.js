// Offline downloads: saves every part of an audiobook to the phone, then plays
// from the local files. Location: public Downloads/Audiohub (visible in the file
// manager) or private app storage — chosen in Settings → Downloads.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted, settings, summarize } from './store.js';

const Native = registerPlugin('InkwellDownloads');
export const canDownload = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellDownloads');

export const downloads = persisted('downloads', {}); // uid -> { book, status, tracks, done, total, bytes, location, error }

const safe = (s) => String(s || 'Audiobook').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const EXT = /\.(mp3|m4b|m4a|aac|flac|ogg|oga|opus|wav|mka)(?:[?#]|$)/i;
const MIME = { mp3: 'audio/mpeg', m4b: 'audio/mp4', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', mka: 'audio/x-matroska' };

const patch = (uid, part) => downloads.set((all) => ({ ...all, [uid]: { ...(all[uid] || {}), ...part } }));

// Native downloads are not automatically resumed after Android kills the WebView.
// Keep finished files, and offer a retry rather than showing a stuck cancel button.
for (const [uid, d] of Object.entries(downloads.get())) {
  if (d?.status === 'downloading')
    patch(uid, { status: 'error', error: 'Interrupted — tap Retry download to continue.' });
}

const expiredLink = (error) => /HTTP (?:401|403|404|410)\b/i.test(error?.message || '');

async function savedPrefix(previous, tracks, folder, target) {
  if (previous?.folder !== folder || previous?.target !== target) {
    // Do not leave untracked files behind when destination or layout changes.
    for (const old of previous?.tracks || []) await Native.remove({ uri: old.uri }).catch(() => {});
    return [];
  }
  const saved = previous?.tracks || [];
  const verified = [];
  for (let i = 0; i < saved.length && i < tracks.length; i++) {
    const old = saved[i];
    if (old.title !== tracks[i].title || !(await Native.exists({ uri: old.uri }).then((x) => x.exists).catch(() => false))) break;
    verified.push(old);
  }
  // Discard stale or mismatched tracked files to avoid leaving invisible duplicates.
  for (const old of saved.slice(verified.length)) {
    await Native.remove({ uri: old.uri }).catch(() => {});
  }
  return verified;
}

export const isDownloaded = (uid) => downloads.get()[uid]?.status === 'done';

/** Swap streaming URLs for the local files of a downloaded book. */
export function applyLocal(details) {
  const d = downloads.get()[details.uid];
  if (!d || d.status !== 'done' || !d.tracks?.length) return details;
  return {
    ...details,
    resolveTracks: undefined,
    chaptersMeta: details.chaptersMeta,
    tracks: d.tracks.map((t, i) => ({ title: t.title, url: t.uri, duration: t.duration, offset: t.offset, index: i })),
    offline: true,
  };
}

let running = new Set();

/** Download every part of `details` (from sources.getDetails). */
export async function downloadBook(details) {
  if (!canDownload) throw new Error('Downloads work in the Android app');
  const uid = details.uid;
  if (running.has(uid)) return;
  running.add(uid);
  const job = `${uid}:${Date.now()}`;
  const target = settings.get().downloadTarget || 'public';
  const folder = `Audiohub/${safe(details.author?.split(',')[0] || 'Unknown author')}/${safe(details.title)}`;
  const previous = downloads.get()[uid];
  patch(uid, { book: summarize(details), status: 'downloading', error: '', job, folder, target });
  const sub = Native.addListener('progress', (e) => {
    if (e.job === job) patch(uid, { current: e.received, currentTotal: e.total });
  });
  try {
    let tracks = details.tracks;
    if (!tracks?.length && details.resolveTracks) tracks = (await details.resolveTracks()).tracks;
    if (!tracks?.length) throw new Error('Nothing to download for this title');
    const saved = await savedPrefix(previous, tracks, folder, target);
    let bytes = saved.reduce((sum, track) => sum + (track.size || 0), 0);
    patch(uid, { total: tracks.length, tracks: saved.slice(), done: saved.length, bytes, current: 0, currentTotal: 0 });
    for (let i = saved.length; i < tracks.length; i++) {
      if (downloads.get()[uid]?.status === 'cancelled') throw new Error('cancelled');
      const t = tracks[i];
      let url = t.resolve ? await t.resolve() : t.url;
      if (!url) throw new Error(`No link for part ${i + 1}`);
      if (/^file:|^content:/.test(url)) {
        saved.push({ title: t.title, uri: url, duration: t.duration, offset: t.offset });
        patch(uid, { done: i + 1, tracks: saved.slice() });
        continue;
      }
      const ext = ((EXT.exec(url) || [])[1] || (EXT.exec(t.title || '') || [])[1] || 'mp3').toLowerCase();
      const name = `${String(i + 1).padStart(3, '0')} - ${safe(t.title).slice(0, 60)}.${ext}`;
      let r;
      try {
        r = await Native.download({ url, headers: t.headers || {}, name, folder, target, job, mime: MIME[ext] || 'audio/mpeg' });
      } catch (err) {
        if (!t.resolve || !expiredLink(err) || downloads.get()[uid]?.status === 'cancelled') throw err;
        // TorBox/Real-Debrid signed download links expire. Request a new one
        // for this track only, then retry once (never loop indefinitely).
        url = await t.resolve();
        r = await Native.download({ url, headers: t.headers || {}, name, folder, target, job, mime: MIME[ext] || 'audio/mpeg' });
      }
      bytes += r.size || 0;
      saved.push({ title: t.title, uri: r.uri, duration: t.duration, offset: t.offset, size: r.size });
      patch(uid, { done: i + 1, bytes, location: r.location, tracks: saved.slice(), current: 0, currentTotal: 0 });
    }
    patch(uid, { status: 'done', tracks: saved, bytes, finishedAt: Date.now() });
  } catch (e) {
    const cancelled = e.message === 'cancelled' || downloads.get()[uid]?.status === 'cancelled';
    const keep = downloads.get()[uid]?.tracks || [];
    if (cancelled) {
      await Promise.all(keep.map((t) => Native.remove({ uri: t.uri }).catch(() => {})));
      downloads.set((all) => {
        const n = { ...all };
        delete n[uid];
        return n;
      });
    } else patch(uid, { status: 'error', error: e.message });
    if (!cancelled) throw e;
  } finally {
    running.delete(uid);
    sub.then((h) => h.remove());
  }
}

export async function cancelDownload(uid) {
  const d = downloads.get()[uid];
  if (!d) return;
  patch(uid, { status: 'cancelled' });
  await Native.cancel({ job: d.job }).catch(() => {});
}

export async function removeDownload(uid) {
  const d = downloads.get()[uid];
  if (!d) return;
  if (d.status === 'downloading') return cancelDownload(uid);
  await Promise.all((d.tracks || []).map((t) => Native.remove({ uri: t.uri }).catch(() => {})));
  downloads.set((all) => {
    const n = { ...all };
    delete n[uid];
    return n;
  });
}

export const publicAvailable = () => (canDownload ? Native.publicAvailable().then((r) => r.available).catch(() => false) : Promise.resolve(false));

export function fmtBytes(n) {
  if (!n) return '0 MB';
  return n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n < 1e7 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e6)} MB`;
}
