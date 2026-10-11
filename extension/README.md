# Chromium passkey extension

**Languages:** English · [Русский](README.ru.md)

This guide belongs beside `extension/chromium/`. It documents the browser companion, not the shared Keyward core; see the [core manual](../docs/core/README.md).

## What it does

The extension lets Chromium websites use passkeys from the user's Keyward vault and save new passkeys to it. It is a companion to the Keyward macOS app and does nothing independently. It handles WebAuthn `navigator.credentials.get/create` calls with `publicKey`; it does not autofill passwords, alter page content or provide general browsing features.

Install the [published Keyward extension](https://chromewebstore.google.com/detail/keyward/codlckblccbcnadacdnoieimkmdieajg) in Chrome or another supported Chromium browser. Install/launch the Keyward macOS app as well: `make install` installs its native messaging host (`me.loper`) and registers the browser bridge. Without the host/app, passkey calls fall back to the browser implementation.

## Pairing: first-run trust ceremony

Pairing authorizes a particular extension-held public key, not merely an extension ID. The extension creates a non-exportable ECDSA P-256 key and signs requests; the app verifies the signature and checks that the key was explicitly paired. Pairings are saved in a hidden item owned by the user's personal vault, not in a local file another same-user process could silently edit and not in a shared organization item. “Hidden” only hides it from Keyward's ordinary lists: it still syncs as a normal vault record and may be visible in the server's web vault.

1. Unlock the vault and leave the Keyward app open.
2. In Chromium, open a site that asks to register or use a passkey. The extension requests pairing and displays **five words**; the app shows a pending request for that browser.
3. Compare every word, and verify the browser/device shown in the Keyward prompt is the one you just initiated. Do not approve a request you did not trigger. Pending requests expire after ten minutes.
4. In the app, approve/pair the matching request with Touch ID, or use the CLI below. Compare the five words shown by the extension and app exactly.
5. Once paired, the extension appears under **Settings → Browsers** with browser/device and last-used details.

CLI controls:

```sh
keyward extension list       # paired and pending extensions; shows comparison words
keyward extension pair       # pair the sole pending request
keyward extension pair 1     # pair a specific pending row by its displayed number
keyward extension unpair 1   # revoke a paired row by number
```

Use the exact row number shown by `list`; pending and paired lists can change. Pairing is always an explicit, Touch ID-confirmed action. Unpair if a browser profile is removed, compromised or no longer needed.

## Sign in and register

- **Sign in:** a website requests a passkey; Keyward offers matching vault records/accounts. Choose the account and approve Touch ID in the app; the browser receives the WebAuthn response/signature, never the private key.
- **Register:** when a site requests a new passkey, choose a new login record or an existing record for that site. Confirm with Touch ID; Keyward stores the passkey in Bitwarden-compatible format in the vault.
- **Another way:** sends the request back to the browser's own WebAuthn implementation.

A prompt names the origin/site and account. If the origin or account does not match your action, decline. The bridge verifies the request signature, freshness and replay status before processing it.

## Permissions and privacy

The extension requests `nativeMessaging` to reach the app and `storage` for `chrome.storage.session` while a chooser is open. Content scripts run on HTTPS pages and localhost; the main-world script intercepts only WebAuthn calls with `publicKey`, top-frame only. The isolated-world bridge takes origin from the browser sender, not page-provided content. The extension has no `tabs`, `scripting`, `webRequest`, broad host permissions, remote code or analytics. Request parameters and chooser labels stay in browser session memory and are cleared when the request/browser ends.

The browser-to-app native-messaging channel is encrypted. Data goes to the Keyward app on the same computer, not to the developer or a third party. The private key remains in the app. Review the full [privacy policy](../docs/extension-privacy.md) for the data types and limits.

## Troubleshooting

- **No pairing request appears:** make sure the app/daemon is running, the vault is unlocked, the official extension is enabled, and `make install` installed the native host; then trigger a fresh WebAuthn request.
- **Words do not match:** cancel. Do not pair; close/reopen the request and compare again.
- **Extension works only in some profiles:** install the extension and pair it separately in each browser profile. Native-host registration is per supported browser installation; if you installed a new browser after Keyward, reinstall the app/bridge and restart that browser.
- **Passkey not offered:** check that the vault has a matching passkey/login for this site and that the request is for a supported WebAuthn operation. Choose “Another way” to use the browser's provider.
- **Remove a stale pairing:** Settings → Browsers → remove, or `keyward extension list` then `keyward extension unpair <number>`.

Pairing does not grant the extension access to all vault passwords. It authorizes signed WebAuthn requests from that extension key; passkey selection and signing remain in the app and require user presence.

Conditional/autofill WebAuthn requests and requests explicitly targeting a cross-platform authenticator use the browser's own provider. Keyward does not replace every WebAuthn flow.
