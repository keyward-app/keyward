# Vaultwarden admin plugin

**Languages:** English · [Русский](README.ru.md)

This guide documents the separately installed Vaultwarden plugin in `crates/plugins/vaultwarden/`. Enable it in Settings → Plugins after reviewing its permissions. It is an admin-panel client for a Vaultwarden server; it does not manage the local Keyward vault account itself. Shared architecture belongs in the [core guide](../../../docs/core/README.md).

## Scope and prerequisites

The plugin talks to the server's `/admin` panel over **HTTPS only**. The server must have its admin panel enabled with `ADMIN_TOKEN`; Keyward requires the actual admin token, not its Argon2 hash. The plugin derives the server from the configured vault account, so an account/server must already be set up. Admin requests are privileged: use a dedicated admin token and only enable this plugin for a server you administer.

There are no `kw-*` item fields in this integration. The token is the plugin's own credential, not an item-level connection schema. It is stored in macOS Keychain, sealed with a key derived from the unlocked vault and retrieved behind the app's Touch ID/user-presence gate. On unlock, Keyward validates the token with the panel before persisting it; a rejected token is not saved. **Lock panel** closes the session and removes the token from Keychain; unlock again requires pasting the token. The core lock event also locks the plugin UI/session.

## Unlock and status

Open **Vaultwarden** in the app, paste the server's `ADMIN_TOKEN` and choose **Unlock**. The plugin logs in over HTTPS, then stores the validated credential in Keychain. It reports when the panel is disabled, unreachable, rate-limited, the token is invalid or the panel session cannot be renewed. Repeated failed attempts may trigger server-side rate limits; wait rather than repeatedly retrying.

## Users

The Users page lists accounts with email/name, enabled/invited state, verification, two-factor status, created/last-active facts and organization memberships. It can invite an email (Vaultwarden sends the invitation; the user creates their own account), resend an invitation and perform state-appropriate actions:

- enable or disable a user;
- deauthenticate (log out on all devices);
- remove two-factor enrollment;
- delete a user;
- assign an allowed role in an organization.

Disabling logs the user out and blocks login until re-enabled. Deauthentication forces another sign-in but does not delete the account. Removing 2FA weakens that account until the user enrolls again. **Deleting a user permanently removes their server items, attachments and memberships; it cannot be undone.** Read the confirmation dialog and target identity carefully.

For organization memberships, the UI distinguishes what the current admin may do. If the admin owns/manages the organization, they can invite/add or remove members. Otherwise the panel can change supported roles, but membership changes must be done by the organization's owner/admin; adding a member transfers access to organization-encrypted material. Available assignable roles follow what the plugin/server exposes; it does not invent a custom role.

## Organizations

The Organizations view groups members by organization and shows owner/member counts, membership status and role. Deleting an organization removes its items, collections and memberships for all members and is **irreversible**. Confirm the exact organization name before deletion.

## Server settings

Settings are read dynamically from the server's admin configuration page and grouped as Vaultwarden presents them (for example general/advanced, SMTP, SSO, push, jobs and other server-specific groups). Editable values may be text, number, password or checkbox. The UI indicates whether a value is set in the panel, its default, and whether it is overridden.

Values controlled by environment variables are shown read-only; they must be changed in the server environment and may require restart. Saving through the plugin sends the full current editable configuration with changes overlaid, because the server replaces the user config as a whole. Secret/password settings are not echoed; an empty password field means keep the existing value. **Reset settings** removes panel overrides, returning values to defaults/environment; it is a broad, non-undoable change. Review the server settings and confirmation before saving/resetting.

## Server tools

- **Database backup:** invokes the server's database backup. Currently supported only for SQLite; Vaultwarden writes a copy next to its database. Keyward does not download or validate that copy. Arrange server-side retention/offsite backup independently.
- **Test SMTP:** asks the server to send a test email to the specified address. Check the address before sending.
- **Lock panel:** forgets the stored admin token and closes the current panel session.

## Permissions and data path

Manifest permissions are `keychain` and `network`. The plugin uses the account's server address and admin token to access Vaultwarden's admin API; it does not read vault items or passwords. The raw token is stored in Keychain under the app's vault-derived protection and is only retrieved while the required user-presence/Touch ID check succeeds. HTTPS is enforced because the admin token accompanies panel requests. The server itself necessarily receives the privileged API requests.

## Failure handling and safety

A missing admin token, disabled panel, invalid URL/certificate or unreachable server will prevent unlock. Do not switch off HTTPS validation or copy the admin token into logs, shell history, screenshots or tickets. User/organization deletion, 2FA removal, disabling accounts and reset of settings all have security or availability impact; follow the confirmation text. This plugin is experimental and unaudited; verify behavior against the Vaultwarden version you operate.
