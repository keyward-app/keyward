# Documentation map

**Languages:** English · [Русский](README.ru.md)

This map is the entry point. The **core manual documents only shared Keyward behavior**. Each integration owns its detailed manual beside its implementation; do not move integration-specific schemas/workflows back into the core guide.

## Core and component guides

- [Keyward core: architecture and user guide](core/README.md) · [Русский](core/README.ru.md)
- [SSH plugin](../crates/plugins/ssh/README.md) · [Русский](../crates/plugins/ssh/README.ru.md)
- [HashiCorp Vault plugin](../crates/plugins/hashicorp/README.md) · [Русский](../crates/plugins/hashicorp/README.ru.md)
- [Kubernetes plugin](../crates/plugins/kube/README.md) · [Русский](../crates/plugins/kube/README.ru.md)
- [Vaultwarden admin plugin](../crates/plugins/vaultwarden/README.md) · [Русский](../crates/plugins/vaultwarden/README.ru.md)
- [Chromium passkey extension](../extension/README.md) · [Русский](../extension/README.ru.md)
- [Web client deployment and security](../web/README.md) · [Русский](../web/README.ru.md)

## Cross-cutting engineering references

- [External plugin protocol and permission boundary](plugin-protocol.md)
- [Plugin catalogue, package validation and publisher trust](plugin-registry.md)
- [Extension privacy policy](extension-privacy.md)
- [Security reporting](../SECURITY.md)
- [Web state-mutation contract and its explicit coverage limits](state-mutation-contract.md)

## Documentation ownership

- Core concepts, account lifecycle, local state and generic security contracts belong in `docs/core/`.
- A plugin's user guide, settings, `kw-*` field schema, permissions, network/data flow, destructive actions and limitations belong in that plugin's own directory under `crates/plugins/<id>/`.
- Browser-extension instructions belong beside the extension; web-client operations belong beside the web app.
- Keep English and Russian guidance paired. Update the owning manual when code, manifest permissions, a field schema or a user-facing operation changes.
- The project README is a short overview and navigation page, not a second copy of every integration manual.
