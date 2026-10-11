# Keyward Core: Architecture and User Guide

**Languages:** English · [Русский](README.ru.md)

This document describes Keyward's shared application core. It intentionally does **not** document the behavior of any one integration; those manuals live next to their implementation under [`crates/plugins/`](../../crates/plugins/). See the [documentation map](../README.md).

## 1. Product boundary

Keyward's core is the local Bitwarden-compatible vault client: account configuration, authentication, encrypted vault synchronization, unlock/lock, record browsing/editing, application settings, and the trusted local control channel. The native macOS window and CLI are clients of a per-user daemon. Integration-specific behavior is delegated to separately documented components; the core does not encode their routes, schemas or workflows.

Supported server families in the project README: Bitwarden cloud, Vaultwarden and compatible Bitwarden-protocol servers. The initial native target is macOS 14+ on Apple silicon. This is experimental software, not an independently audited password manager.

## 2. Runtime and data flow

```text
macOS window / CLI ── authenticated, sealed local channel ──► per-user daemon
                                                           │
                                                           ├── account/session + vault crypto
                                                           ├── HTTPS API ──► Bitwarden-compatible server
                                                           └── capability-checked Host boundary ──► integrations
```

The daemon owns the unlocked key material and is the authority for vault state. The GUI renders views and gathers user intent; it does not become a second owner of decrypted vault state. CLI requests use the same local service boundary. The process is started for the user by a LaunchAgent after installation.

The vault server stores Bitwarden-format encrypted records. Keyward authenticates, derives/unlocks the keys, syncs the encrypted snapshot and decrypts records locally for use. Local session material and the remote encrypted snapshot are distinct: the snapshot is ciphertext; the session contains authentication/key metadata and is sealed locally. Account-specific filenames are hashed rather than exposing the account identifier. Sensitive local files are created with restrictive permissions and atomic replacement where implemented. See [`crates/core/src/paths.rs`](../../crates/core/src/paths.rs), [`crates/vault/`](../../crates/vault/) and [`crates/bw/`](../../crates/bw/).

A lock is a security transition, not merely a hidden window: the daemon drops in-memory unlocked key material and emits the locked event. Dependent live capabilities must tear down their sessions/sockets and clear their copies. A later use requires unlock again. Lock timeout, lock-vs-logout action, Touch ID and clipboard behavior are configurable in app settings.

## 3. Records and custom fields

Keyward preserves the Bitwarden-compatible item model rather than inventing a second server-side record system. Ordinary user data remains user-owned. A custom-field name is not a safe place for an integration to silently claim arbitrary user fields; integrations therefore use an explicit namespace convention: **`kw-`**.

Why that convention exists:

1. **Ownership is visible by convention.** `kw-host` or `kw-vault-addr` signals that a Keyward component assigns meaning to the field. A user's `environment`, `host` or `token` field is not reinterpreted accidentally.
2. **The server schema remains compatible.** These are custom fields carried inside ordinary encrypted vault items, not new server database columns or a parallel credential store. They can sync with the item and remain associated with the item they configure.
3. **The core stays generic.** Core does not parse every `kw-*` name or need to know what a host route, Vault connection or kubeconfig means. The owning component documents and validates its own schema.
4. **Access can be bounded.** An external plugin can request a custom-field value through `secret` only when the field name starts with `kw-` (case-insensitive); it cannot use that method to fetch a password, TOTP, private key or an arbitrary user-named field. Important precision: the current gate checks only the prefix—not which plugin owns the name or whether the field is marked protected/hidden. Per-plugin ownership is a documented schema convention, not a technical namespace ACL. The plugin must also declare `secrets`, and every Host method is checked against declared permissions. Writes go through explicit host methods and require `items_write`.

The prefix is a **namespace marker, not a cryptographic trust marker, per-plugin ACL or field-type check**: it does not itself make data secret or prove a plugin is safe. The external read gate does not verify that a custom field is marked protected/hidden; use the vault's protected custom-field type for sensitive values and treat any `secrets` plugin as trusted with `kw-*` custom-field values. A plugin with both `secrets` and `network` deserves especially careful review. Field-level specifications belong in the individual plugin manual; see the [plugin index](../../crates/plugins/README.md).

Some components mark their service items as hidden so they do not clutter Keyward's ordinary lists. This is an application-level UI convention, not another vault or server security boundary: the item still syncs as an ordinary Bitwarden-compatible record and may be visible in the server's own web vault. Treat fields such as a managed root token according to their secret value, not the hidden marker.

## 4. The plugin boundary (core-level contract)

Plugins are optional capabilities, not a second core. A plugin has an identifier, manifest, declared permissions, settings and an integration-owned UI declaration. The UI host renders that declaration. The shipped SSH, HashiCorp Vault, Kubernetes and Vaultwarden integrations are installed as separate executables and are not loaded into the daemon's address space. A fresh installation leaves them disabled; enable the integrations you need in Settings → Plugins after reviewing their permissions. Reinstallation preserves their enabled/disabled state.

An external package starts disabled. Enabling it is consent to the permissions shown by its manifest; the daemon checks each Host method on every call. Unknown methods are refused. The protocol v2 plugin pipe uses a Noise handshake and authenticated encryption; plaintext fallback is not allowed. This reduces accidental privilege sharing but does not make the plugin author's code trustworthy.

Important nuance: `network` is disclosed as a requested permission, but the core cannot intercept arbitrary network calls made by a child process. Treat it as a trust disclosure rather than a technical network sandbox. `secrets` + `network` can expose secrets outside the machine. Full protocol and packaging detail: [plugin protocol](../plugin-protocol.md) and [catalogue/install checks](../plugin-registry.md).

## 5. Core user workflows

### Account lifecycle

1. Configure a cloud region or self-hosted server and account identifier.
2. Sign in with the master password and any supported second factor requested by the server.
3. Unlock the vault in the app. Optionally use `keyward remember` to verify and store the master password behind macOS Keychain user-presence controls, then unlock with Touch ID.
4. Sync when needed. Lock the vault when leaving the machine; a lock removes unlocked keys from memory and closes dependent agent sessions.

CLI basics:

```sh
keyward setup --region self --url https://vault.example.com --email you@example.com
keyward login
keyward status
keyward sync
keyward lock
```

For exact flags: `keyward --help` and `keyward setup --help`.

### Browsing and editing

The native app provides a home across personal and organization owners, searchable lists and item detail pages. Supported record kinds include logins, secure notes, identities, cards and SSH-key records. Sensitive values are masked until deliberately revealed or copied. TOTP and passkeys can appear with the compatible item. The command/search line is also navigation: `⌘K` focuses it; action queries prefixed with `>` show a preview before execution.

The app supports password generation, clipboard clearing, website-icon preferences, language/theme/accent choices, menu-bar behavior, launch-at-login, automatic lock/logout behavior and Touch ID prompting. Settings are local app behavior unless a setting explicitly belongs to the vault or a service component.

### Browser passkeys

WebAuthn in Chromium uses a separate extension and local native-messaging host, not a browser plugin loaded into the core. Pairing is a user-verified key comparison; passkey signing and registration are approved by Touch ID in the app. See [extension usage/privacy](../../extension/README.md) and the [privacy statement](../extension-privacy.md).

## 6. Local state and trust boundaries

The default application home is `~/.keyward` (overridable with `KEYWARD_HOME` in development/test contexts). It contains app settings, account registry, account-bound session/snapshot data, SSH host trust data, sockets and external-plugin state. Do not copy this directory into issue reports or share it unredacted. Specific files and formats are implementation details and may migrate between versions.

The user trusts several distinct parties:

- **Vault service:** receives authentication/API traffic and stores ciphertext; it is not handed unlocked client keys by the encryption protocol.
- **Local Mac and account:** the daemon, OS account, Keychain and running processes are within the local trust boundary.
- **Keyward code:** the app and daemon necessarily process secrets locally; experimental status and lack of independent audit matter.
- **External integration processes:** only the permissions and specific Host methods constrain access; requested `network` is not an OS-level network sandbox.
- **Browser app origin (web build):** deployment server can replace its JavaScript. The web client has a separate threat model; see [`web/README.md`](../../web/README.md).

## 7. Security properties and known gaps

Implemented safeguards described by the project include sealed local daemon communication, encrypted plugin pipes, locally held vault cryptography, restricted Keychain access for remembered credentials, clipboard expiry, locking that removes agent sockets, and network-library logging disabled to avoid credentials in traces. Security-sensitive behavior is still experimental and must be validated in the exact release/build you use.

Vault cryptography uses Keyward-owned code over RustCrypto with no rbw dependency. PBKDF2 and Argon2id accounts and authenticated type-2 symmetric ciphertexts are supported; legacy unauthenticated type-0 and type-7 COSE ciphertexts are unsupported. A complete two-way compatibility check with official Bitwarden Desktop remains pending.

SSH supports Ed25519, RSA and supported ECDSA OpenSSH keys, per-host session-binding verification and terminal host-trust prompts. Pin verification by the agent requires a client that sends session binding. Hardware-token keys, terminal proxy-jump/certificate sessions and Vault SSH certificate issuance are unsupported. Consult the integration manual for details. No statement here is an independent audit finding or certification.

## 8. Development and evidence

Repository checks:

```sh
npm ci
npm run build
cargo test --workspace --locked
cargo build -p keyward-cli --locked
./scripts/smoke.sh
node scripts/native-vault-contract.mjs
make run
```

The demo stand (`npm -w @keyward/stand run dev`) uses fake fixtures and does not require a live daemon/vault. Tests are scoped: a passing suite does not prove every UI flow, service operation, plugin permission, mutation or platform path correct. The web state-mutation contract specifically documents what it covers and defers in [`docs/state-mutation-contract.md`](../state-mutation-contract.md).

## 9. Where detailed documentation lives

| Subject | Owner and documentation |
|---|---|
| Core architecture and user workflows | This document; [`Русский`](README.ru.md) |
| SSH agent, key routing, terminal, health checks | [`SSH plugin`](../../crates/plugins/ssh/README.md) · [`Русский`](../../crates/plugins/ssh/README.ru.md) |
| HashiCorp Vault broker and secrets | [`HashiCorp plugin`](../../crates/plugins/hashicorp/README.md) · [`Русский`](../../crates/plugins/hashicorp/README.ru.md) |
| Kubernetes discovery and operations | [`Kubernetes plugin`](../../crates/plugins/kube/README.md) · [`Русский`](../../crates/plugins/kube/README.ru.md) |
| Vaultwarden admin panel | [`Vaultwarden plugin`](../../crates/plugins/vaultwarden/README.md) · [`Русский`](../../crates/plugins/vaultwarden/README.ru.md) |
| Chromium passkey extension | [`extension/README.md`](../../extension/README.md) · [`Русский`](../../extension/README.ru.md) |
| Browser/web client | [`web/README.md`](../../web/README.md) · [`Русский`](../../web/README.ru.md) |
| External plugin protocol/catalogue | [protocol](../plugin-protocol.md) · [registry](../plugin-registry.md) |

## 10. Security reporting

Keyward handles passwords and private keys. Report vulnerabilities privately via GitHub **Security → Report a vulnerability**; do not open a public issue with exploit details. See [`SECURITY.md`](../../SECURITY.md).
