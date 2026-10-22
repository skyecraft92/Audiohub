# Security notes and migration

This fork is under active review. These initial changes address account verification and reduce default credential syncing. They do **not** constitute a full security audit.

## Important: migrate older Supabase projects

Older Audiohub versions installed a public `audiohub_confirm(p_email text)` SQL function with `SECURITY DEFINER` privileges and granted execution to the `anon` role. This allowed a caller to mark an arbitrary account email as confirmed without demonstrating control of that email inbox.

**Updating the app does not remove database functions.** On each existing Supabase sync project:

1. Open the Supabase project dashboard and navigate to **SQL Editor**.
2. Execute this one-time migration:

   ```sql
   drop function if exists public.audiohub_confirm(text);
   ```

3. Verify the function is absent:

   ```sql
   select n.nspname as schema, p.proname as function_name
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'audiohub_confirm';
   ```

   It should return zero rows.

4. In **Authentication → Providers → Email**, keep email confirmation **enabled**, and configure working email delivery (for example, a supported SMTP provider). Check that signup sends a verification link and that an unverified account cannot sign in.
5. Existing installations may retain `syncKeys: true` from earlier versions. Review **Settings → Account & sync → Sync service keys**. Turn it off if unwanted and complete another sync. This can remove those sections from the current remote JSON, but it cannot guarantee removal from backups or snapshots.
6. Avoid publishing Supabase `service_role` keys, database passwords, Android signing keys, or provider tokens. The public anon/publishable key is intended for clients, but database row-level security must be configured correctly.

For new projects, the **Copy SQL** button includes the removal statement. Re-running the current setup SQL also removes the legacy function.

## Current limitations

- **Android fork:** account, Audiobookshelf, TorBox/Real-Debrid, Hardcover, qBittorrent and AI credential-bearing store snapshots are now encrypted with a non-exportable Android Keystore key (AES-256-GCM). The ciphertext lives in Android's non-backed-up app directory. On first startup, old plaintext WebView entries are migrated, verified, and removed. If the Keystore fails, Android startup stops rather than silently discarding or re-creating the credentials.
- **Web/PWA:** credentials still live in browser localStorage; this is **not** equivalent to Android Keystore and requires separate hardening.
- Upgrades require keeping the same Android package and signing key. Uninstalling, clearing app data or replacing the device deletes the Keystore key and encrypted secrets. Move/export credentials separately before switching phones.
- Any legacy plaintext SQLite pages or browser backups that existed *before migration* may persist in old backups or database free pages. App-side deletion does not retroactively erase all copies.
- Provider credentials can be synced in plaintext within the authenticated user record when the opt-in setting is enabled. Supabase RLS is an access-control boundary, not end-to-end encryption.
- The web relay, installed addons, in-app updater and Android cleartext/backup settings need separate threat modelling and testing.
- No penetration test, external deployment audit, or reproducible APK verification is claimed by this patch.

## Reporting security vulnerabilities

Do not publish usable exploit details or real credentials in public GitHub issues. Contact the fork maintainer through a private communication channel or GitHub's private vulnerability reporting feature if enabled. For bugs inherited from upstream, coordinate disclosure with the original developer where appropriate.
