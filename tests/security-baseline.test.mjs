import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sync = readFileSync(new URL('../src/lib/sync.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/screens/settings-extra.jsx', import.meta.url), 'utf8');

test('credential syncing is opt-in for new installations', () => {
  assert.match(sync, /syncKeys:\s*false\b/);
  assert.match(sync, /if \(s\.secret && !cfg\(\)\.syncKeys\) continue/);
});

test('no unauthenticated email confirmation bypass is generated or invoked', () => {
  assert.doesNotMatch(sync, /rpc\/audiohub_confirm/);
  assert.doesNotMatch(sync, /grant execute on function public\.audiohub_confirm/i);
  assert.doesNotMatch(sync, /security definer/i);
  assert.match(sync, /drop function if exists public\.audiohub_confirm\(text\);/);
});

test('unverified sign-ins require email confirmation', () => {
  assert.match(sync, /Email not confirmed\. Check your inbox/);
  assert.match(sync, /Check your email for the verification link/);
  assert.doesNotMatch(sync, /switch off [“"]Confirm email/i);
});

test('UI explains the migration and optional credential syncing', () => {
  assert.match(settings, /Off by default on new installs/);
  assert.match(settings, /re-run the setup SQL/);
  assert.match(settings, /must verify their email/);
});
