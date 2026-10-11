# HashiCorp Vault plugin

**Languages:** English · [Русский](README.ru.md)

This manual belongs to `crates/plugins/hashicorp/`. It covers this integration only. Shared account, daemon, encrypted-vault and plugin-boundary architecture is documented in the [core manual](../../../docs/core/README.md).

## What it does

The plugin is a Vault client and short-lived-access broker. It can connect to one selected Vault at a time (multiple connections may be stored), inspect health/seal state, unseal, bootstrap/manage a root token, issue and revoke Vault tokens, inspect/manage policies, enable/disable/tune secrets engines and auth methods, and operate on KV secrets and versions. It is not the Bitwarden/Vaultwarden vault backend; it is an integration to a separate HashiCorp Vault service.

The plugin is installed as a separate executable. Enable HashiCorp Vault in Settings → Plugins after reviewing its permissions. Its UI is rendered by Keyward's window, while network/API operations run in the plugin process.

## Connection fields: why `kw-*`

A Vault connection is represented by custom fields on an ordinary vault item. The `kw-` namespace tells Keyward that the field belongs to this integration, prevents accidental collision with arbitrary user fields, lets the item and its configuration sync together, and keeps integration schema out of the generic core. These are still encrypted item fields on the Bitwarden-compatible server. The plugin does not own a separate plaintext credential database.

| Field | Purpose |
|---|---|
| `kw-vault-addr` | Vault base URL; identifies/locates the connection. |
| `kw-vault-role-id` | AppRole `role_id`. |
| `kw-vault-secret-id` | AppRole `secret_id`; store as a protected custom field. |
| `kw-vault-namespace` | Optional Enterprise namespace. |
| `kw-vault-token` | Managed root-token value in the hidden per-Vault service item; used as an authentication fallback when AppRole is unavailable. Protect as a secret. |
| `kw-vault-unseal-fields` | Comma-separated names of custom fields containing Shamir unseal shares. It stores field names, not a second copy of share values. |
| `kw-issued` | Issuance ledger on the hidden per-Vault service item; contains accessors and metadata, never issued token values. |
| `kw-root-addr`, `kw-root-issued`, `kw-root-revoked` | Metadata for the managed root-token record/lifecycle. |
| `kw-hidden` | Keyward's UI-level hidden service-item marker; the record still syncs as a normal vault item and may be visible in the Bitwarden/Vaultwarden web UI. |

The UI selects an ordinary note to associate with a connection and asks which existing note fields contain unseal shares. Prefer this flow instead of hand-authoring metadata. With `secrets` permission, the plugin can independently request custom-field values only when names start with `kw-`. The gate checks the prefix, not per-plugin ownership or protected/hidden type; treat `secrets` as access to all `kw-*` custom values. For selected share fields outside that namespace, the window reads the values through the user's explicit unseal/root-generation flow and passes them to the operation; the plugin cannot read them in the background.

Root-token material and the issuance ledger live on a separate hidden **personal/owned** service item for each Vault address—not on the connection note or an organization-shared note. The plugin ignores hidden items not owned by the current user, preventing an organization member from planting a lookalike ledger or causing a root token to be written into a shared note. The hidden marker is only for Keyward's lists; the record remains visible as a normal secure note in the server's web vault.

## Connect and unseal

1. Open **HashiCorp Vault** from Keyward's plugin navigation and choose **Connect**.
2. Enter the Vault URL. The plugin probes the endpoint before saving the connection.
3. Choose an existing ordinary vault note/record or create one for connection metadata; select the existing custom-field names containing unseal shares if using Shamir. The plugin records the names, not extra copies of the values.
4. Configure `role_id` and `secret_id` for AppRole, plus namespace if applicable. If AppRole is not configured and a managed root token is present, the broker can authenticate with that token from the hidden item. Prefer a limited AppRole for normal operation.
5. If the server is sealed, enter only enough shares to reach its threshold. Root-token generation is a separate, high-risk ceremony; shares are collected into the daemon-side operation and the generated token is stored in a separate hidden service item, not rendered as ordinary screen text.
6. Select the connection to make it active. The broker operates on that connection; selecting another switches the active Vault.

Unseal shares are powerful credentials. Never put them in shell arguments, source control, screenshots or ordinary logs. Do not use a root token for routine operations.

## Token broker: issue, hand over, audit, revoke

Use the **Issued access**/issue workflow from the Vault console. A request names a recipient category (agent, person, or self), policies, TTL, optional use limit, optional response wrapping and a note. The UI offers TTL presets of 5m, 15m, 30m, 1h, 4h and 24h. Recipient defaults are 15 minutes for an agent, 1 hour for a person and 30 minutes for self; the actual request is visible before issuance. A zero use limit means unlimited uses, not single use.

Vault may issue a regular token or, when wrapping is requested, a one-time wrapping token. A wrapping token must be exchanged once through Vault unwrap; if already consumed, treat it as intercepted and revoke/reissue. Never put a wrapping token into `VAULT_TOKEN` as though it were the final credential.

The ledger keeps the Vault **accessor**, recipient/note, policies, TTL and state—never the issued bearer token. An accessor can revoke the token without retaining the token itself. Active rows can be revoked from the UI; expirations are marked during refresh/tick, with notices shortly before expiry (within two minutes) and at expiry when notices are enabled. Issued material is copied through the core clipboard capability, which conceals and clears it according to app policy.

High-privilege `root`/`sudo` policies and the broker's own `keyward-policy-admin` policy require explicit “wide access” consent and are capped by the plugin's safety checks (root-equivalent access is limited to at most one hour). Use minimal policies, the shortest practical TTL and the smallest scope. The special `keyward-policy-admin` is retained only while an active Keyward-issued token needs it; cleanup does not replace reviewing policies or revoking credentials.

## Policies and engines

The console can list/read/write/delete ACL policies and inspect/mount/disable/tune secrets engines and auth methods. Engine settings include description and default/max lease TTL. KV mounts can be KV v1 or v2; the UI exposes KV v2 configuration such as `max_versions`, `cas_required` and `delete_version_after`. KV v1→v2 migration is not reversible; policy paths differ (`data/` and `metadata/` for v2), so review policies and migration effects before changing versions.

Mount paths and engine types are validated. Do not disable an auth method or engine casually: access methods, data and dependent policies can be affected. Exact available engine/auth types depend on the Vault server and plugin version.

## KV secrets and versions

The plugin browses key/value mounts, lists paths, reads a selected secret, copies individual values, creates/updates records and edits metadata. For KV v2, it can display version history, restore a previous version by writing it as a new current version, undelete a soft-deleted version, permanently destroy a version, and alter per-secret metadata. Writes use Check-And-Set where available to reduce lost updates.

Secret values are not included in the ordinary list/details response; the UI shows key names and value lengths, retrieving an individual value only when needed for reveal/copy or editing. Copying routes through the core clipboard path. Deletion can be soft or permanent where the KV engine supports that distinction. Permanent destroy, metadata changes and policy edits are high-impact; inspect the mount/path/version and confirmation preview carefully.

## Permissions and trust

The manifest requests `entries`, `items`, `items_write`, `secrets`, `notices`, `network` and `clipboard`. These permit locating the plugin's own tagged connection/service items, selecting item data/fields, writing plugin metadata, reading protected plugin-owned credentials, notifying about expirations, communicating with Vault and copying results. `network` is a declared consent item, not an OS-enforced network sandbox.

The plugin stores connection state and the issuance ledger in vault items; active connection choice/notice preference are plugin settings. The root-token record is hidden. Review permissions and protect access to the machine/vault. A ledger disclosure alone should not provide a usable issued bearer token, but the plugin still has authority to contact Vault using its configured credentials.

## Limitations and safe operation

- One active Vault connection is used at a time.
- This is infrastructure administration: use a test Vault first and least-privilege policies.
- Root tokens and unseal shares can compromise the whole Vault; minimize their lifetime and exposure.
- A short TTL limits credential lifetime but does not constrain what a token can do while valid.
- Browser/app clipboard clearing and notifications reduce exposure; they do not make copied tokens safe to paste into untrusted processes.
- The project is experimental and unaudited. Check the exact plugin build and Vault edition/API behavior you deploy.
