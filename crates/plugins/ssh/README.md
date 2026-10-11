# SSH plugin

**Languages:** English · [Русский](README.ru.md)

This manual belongs to `crates/plugins/ssh/`. It describes the SSH integration only; shared account, daemon and vault architecture belongs in the [core manual](../../../docs/core/README.md).

## Purpose and model

The plugin maps a destination to a vault SSH-key item and serves a dedicated agent socket for that host. The socket offers exactly one identity, so OpenSSH does not probe every key in the vault. The daemon—not the plugin—holds the private key and performs signing through the `ssh_sign` Host capability. The plugin receives the signature result, not private-key bytes.

Enable SSH in Settings → Plugins after installation. The route table is rebuilt from unlocked vault entries when the vault unlocks or items change. Rebuilding retires existing agent sockets so they cannot keep an old key; run a new resolve (normally through the OpenSSH configuration below) before using the agent again. On lock, the plugin closes terminal sessions, drops per-host/shared sockets and clears its in-memory entries and mappings.

## Binding a key to hosts

In **SSH → Routes**, choose a key and bind one or more comma-separated patterns. The plugin writes routing metadata as custom fields on that same vault item. The `kw-` prefix marks integration-owned metadata: it avoids treating a person's unrelated `host`, `user` or `port` field as SSH configuration, preserves the data on the item as it syncs, and lets the core/plugin boundary distinguish plugin-owned fields. These fields are not new server columns.

| Custom field | Meaning and format |
|---|---|
| `kw-host` | Required route list; comma-separated patterns `[user@]host[:port]`. Example: `*.example.net, git.example.com, admin@node1.*:2222`. Empty unbinds the item. |
| `kw-user` | Default login for terminal/health operations when a route does not name a user. Not itself a match condition. |
| `kw-port` | Default port for terminal/health operations when a route does not name a port. Must be an integer 1–65535. |
| `kw-confirm` | When set to `yes`, `true`, `1` or `on`, require a confirmation for each signature made with this item. |
| `kw-hostkey` | Optional expected server host-key fingerprint/pin. The terminal checks it; the per-host agent checks it when the SSH client sends a valid session-binding message. A mismatch is refused. |
| `kw-knownhosts` | Integration-owned remembered host-key records. The SSH flow writes/manages these; do not hand-edit the serialized value. |
| `kw-cert` | Certificate-role metadata is represented in the route model, but this plugin does not currently issue Vault SSH certificates. |

Use the Routes editor when possible; it validates login/port and writes the route fields through the app. SSH key records can be generated as Ed25519 or RSA, or imported from OpenSSH private-key text (including encrypted keys with a passphrase) or RSA PEM (PKCS#1/PKCS#8). Encrypted PEM is unsupported. Import converts supported material to OpenSSH format before saving. Regenerating/replacing a key changes its public identity: update `authorized_keys` on servers before relying on the new key.

### Matching rules

The parser splits `kw-host` on commas and validates each pattern. `*` is the supported wildcard. A route matches only if its host pattern matches and any declared user/port constraints match the SSH request. Winner priority is lexicographic: exact hostname over wildcard, longer literal host portion, then constrained user, then constrained port. Equal-specificity contenders are reported as ambiguous. The implementation returns a deterministic winner (item name, then pattern) and warns; treat that warning as a configuration defect and make the winner unique.

`keyward hosts` prints the active mapping table. `keyward status` reports mapping count, live sockets, unmapped SSH items and warnings when the SSH plugin responds.

## OpenSSH integration and agent sockets

Print the recommended configuration with:

```sh
keyward ssh-config
```

Add the output at the **end** of `~/.ssh/config`, after Host blocks and aliases:

```sshconfig
Match exec "/Users/you/.local/bin/keyward resolve %h %r %p"
  IdentityAgent /Users/you/.keyward/s/%h.sock
  IdentityFile /Users/you/.keyward/s/%h.pub
  IdentitiesOnly yes
```

Use the exact absolute paths printed by your installation. The `Match` line must appear after `Host` blocks so `%h` resolves to the actual host rather than an alias before `HostName` is applied. Absolute CLI paths matter because `Match exec` runs under `/bin/sh` and GUI applications may have a different `PATH`.

`IdentityAgent` selects the per-host socket. `IdentityFile` points to a **public-only** `.pub` sidecar: OpenSSH needs this identity listed when `IdentitiesOnly yes` is active; signing still happens through the agent and the private half is not written there. Socket names are sanitized from the host. When no route exists, the daemon is unavailable, or the agent is disabled, the resolver returns no match and OpenSSH can fall back to its ordinary key-file behavior.

The socket directory is restricted to the user (0700); sockets are restricted (0600). Do not loosen these permissions. The optional shared socket is `~/.keyward/agent.sock`; it is off by default because it offers all keys and restores the key-probing behavior this plugin is designed to avoid. If enabled for a client that ignores `ssh_config`, set `SSH_AUTH_SOCK` to the path shown in SSH settings and understand that the shared agent can offer multiple keys.

After changing vault items, sync; use `keyward reload` to request route reload if needed. Locking the vault tears the sockets down.

## SSH settings

In **SSH → Settings**:

- **Agent enabled**: controls whether Keyward answers per-host agent requests; disabled behaves as no Keyward agent.
- **Ask**: `Never` (still honors `kw-confirm`) or `Always`; confirmation uses Touch ID/approval flow.
- **Shared socket**: optional all-keys socket for tools that ignore SSH config; disabled by default.
- **Health interval**: off, 15, 30, 60 or 180 minutes. Health checks offer each key to its declared destination without making a signature; results show whether the server still accepts it.

## Terminal, host trust and diagnostics

The SSH area also provides interactive SSH sessions, host pages and a key-health board. A connection form can use the matched route or an explicitly chosen key. A first-seen host key is shown for the user to trust; a changed host key is refused until resolved. Host trust is local/integration-managed and may be associated back with item metadata. A pin in `kw-hostkey` makes the expected fingerprint explicit.

`ssh -v host` helps inspect OpenSSH config and agent selection. Check `keyward hosts`, the app's SSH settings/status and the displayed host-key fingerprint before approving a connection. A successful route match does not mean the remote server accepts the public key; install the corresponding public key on the server and inspect health results.

## Permissions and data access

Manifest permissions: `entries`, `items_write`, `notices`, `ssh_sign`, `network`. They cover listing vault entries/keys, writing the integration-owned routing fields, sending notices, requesting signatures from core, and network connections for SSH terminals/checks. The private key itself is never returned through the plugin API. Network permission is a disclosure/consent item, not an OS network sandbox for a child process.

## Current limitations

The daemon signs Ed25519, RSA and supported ECDSA OpenSSH keys; hardware-token keys cannot sign through Keyward. The per-host agent verifies OpenSSH session-binding messages, including host proof and a configured pin. Clients that do not send session binding provide no host proof to the agent; use OpenSSH's host-key checking as well. The terminal has its own explicit host-trust flow. Terminal SSH proxy-jump and SSH-certificate sessions are unsupported, and `kw-cert` does not mint certificates. The application is experimental and unaudited.
