//! Keyward's native vault crypto boundary.
//!
//! Bitwarden formats over the owned protocol implementation and RustCrypto.
//! Secret buffers are fixed allocations, wiped before their memory lock drops.
//! No Debug, serialization or Deref exposes their contents.

use std::collections::HashMap;
use keyward_bw::crypto::{Kdf, MasterKey, SymmetricKey, EncString};
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use hmac::Mac as _;
use zeroize::{Zeroize, Zeroizing};

pub(crate) const LOCKED_CAPACITY: usize = 4096;

pub struct SecretBytes {
    // Drop wipes first; then the guard unlocks before the allocation is freed.
    _lock: Option<region::LockGuard>,
    data: Box<Zeroizing<[u8; LOCKED_CAPACITY]>>,
    len: usize,
}

impl Default for SecretBytes {
    fn default() -> Self {
        let data = Box::new(Zeroizing::new([0; LOCKED_CAPACITY]));
        // As before, memory-lock failure does not prevent unlocking. Never
        // panic if OS lock limits change after a previous successful lock.
        let lock = region::lock(data.as_ptr(), LOCKED_CAPACITY).ok();
        if lock.is_none() {
            static WARN: std::sync::Once = std::sync::Once::new();
            WARN.call_once(|| tracing::warn!("protected memory lock is unavailable; secret buffers still zeroize on drop"));
        }
        Self { data, len: 0, _lock: lock }
    }
}
impl Clone for SecretBytes {
    fn clone(&self) -> Self {
        let mut copy = Self::new();
        copy.data[..self.len].copy_from_slice(self.data());
        copy.len = self.len;
        copy
    }
}
impl Drop for SecretBytes {
    fn drop(&mut self) { self.data.zeroize(); }
}

impl SecretBytes {
    pub fn new() -> Self { Self::default() }
    pub fn data(&self) -> &[u8] { &self.data[..self.len] }
    pub fn truncate(&mut self, len: usize) {
        if len < self.len { self.data[len..self.len].zeroize(); self.len = len; }
    }
    pub fn extend(&mut self, bytes: impl Iterator<Item = u8>) -> anyhow::Result<()> {
        let original_len = self.len;
        for byte in bytes {
            if self.data().len() == LOCKED_CAPACITY {
                self.truncate(original_len);
                anyhow::bail!("secret input exceeds native buffer capacity");
            }
            self.data[self.len] = byte;
            self.len += 1;
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct Keys(SecretBytes);

impl Keys {
    pub fn new(bytes: SecretBytes) -> Self {
        assert!(bytes.data().len() >= 64, "key material must contain encryption and MAC keys");
        Self(bytes)
    }
    pub fn enc_key(&self) -> &[u8] { &self.0.data()[..32] }
    pub fn mac_key(&self) -> &[u8] { &self.0.data()[32..64] }
    fn symmetric(&self) -> anyhow::Result<SymmetricKey> { SymmetricKey::from_bytes(&self.0.data()[..64]) }
}

/// Authenticated symmetric ciphertext only. RSA protected-key unwrap is
/// handled explicitly by unlock rather than normalized by this parser.
/// Plaintext returned by `decrypt_locked_symmetric` retains
/// PKCS#7 padding, matching the existing passkey/item-key callers.
pub(crate) struct CipherString(EncString);

impl CipherString {
    pub(crate) fn new(text: &str) -> anyhow::Result<Self> {
        let (kind, _) = text.split_once('.').ok_or_else(|| anyhow::anyhow!("invalid ciphertext format"))?;
        if kind != "2" {
            anyhow::bail!("unsupported symmetric ciphertext type");
        }
        let parsed = EncString::parse(text)?;
        if let EncString::Symmetric { iv, ct, mac } = &parsed {
            if iv.len() != 16 || ct.is_empty() || ct.len() % 16 != 0 || mac.len() != 32 {
                anyhow::bail!("invalid authenticated ciphertext structure");
            }
        }
        Ok(Self(parsed))
    }
    pub(crate) fn encrypt_symmetric(keys: &Keys, text: &[u8]) -> anyhow::Result<Self> {
        Ok(Self(EncString::encrypt(&keys.symmetric()?, text)?))
    }
    pub(crate) fn decrypt_symmetric(&self, keys: &Keys, item: Option<&Keys>) -> anyhow::Result<Vec<u8>> {
        self.0.decrypt(&item.unwrap_or(keys).symmetric()?)
    }
    pub(crate) fn decrypt_locked_symmetric(&self, keys: &Keys) -> anyhow::Result<SecretBytes> {
        self.decrypt_locked_with(&keys.symmetric()?)
    }
    fn decrypt_locked_with(&self, keys: &SymmetricKey) -> anyhow::Result<SecretBytes> {
        if self.symmetric_ciphertext_len().is_none_or(|len| len > LOCKED_CAPACITY) {
            anyhow::bail!("ciphertext exceeds native buffer capacity");
        }
        let EncString::Symmetric { iv, ct, mac } = &self.0 else { anyhow::bail!("symmetric ciphertext required"); };
        // Authentication precedes both copying and decrypting the payload.
        let mut hmac = hmac::Hmac::<sha2::Sha256>::new_from_slice(keys.mac_key())?;
        hmac.update(iv); hmac.update(ct);
        hmac.verify_slice(mac).map_err(|_| anyhow::anyhow!("the mac does not match: a wrong key or a forgery"))?;
        let mut plain = SecretBytes::new();
        plain.extend(ct.iter().copied())?;
        cbc::Decryptor::<aes::Aes256>::new_from_slices(keys.enc_key(), iv)?
            .decrypt_padded_mut::<Pkcs7>(&mut plain.data[..plain.len])
            .map_err(|_| anyhow::anyhow!("invalid ciphertext padding"))?;
        Ok(plain)
    }
    fn decrypt_unpadded(&self, keys: &SymmetricKey) -> anyhow::Result<SecretBytes> {
        let mut plain = self.decrypt_locked_with(keys)?;
        let pad = usize::from(*plain.data().last().ok_or_else(|| anyhow::anyhow!("empty plaintext"))?);
        plain.truncate(plain.len - pad);
        Ok(plain)
    }
    pub(crate) fn symmetric_ciphertext_len(&self) -> Option<usize> {
        match &self.0 {
            EncString::Symmetric { ct, .. } => Some(ct.len()),
            _ => None,
        }
    }
}

impl std::fmt::Display for CipherString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { self.0.fmt(f) }
}

pub(crate) fn unlock(
    email: &str,
    password: &str,
    kdf: Kdf,
    protected_key: &str,
    protected_private_key: &str,
    protected_org_keys: &HashMap<String, String>,
) -> anyhow::Result<(Keys, HashMap<String, Keys>)> {
    let kdf = kdf.checked()?;
    for protected in [protected_key, protected_private_key] {
        let parsed = CipherString::new(protected)?;
        if parsed.symmetric_ciphertext_len().is_none_or(|len| len > LOCKED_CAPACITY) {
            anyhow::bail!("protected ciphertext exceeds native buffer capacity");
        }
    }
    let master = MasterKey::derive(password, email, kdf)?;
    let user = CipherString::new(protected_key)?.decrypt_unpadded(&master.stretch()?)
        .map_err(|_| anyhow::anyhow!("Password is incorrect. Try again."))?;
    if user.data().len() != 64 { anyhow::bail!("invalid protected user key length"); }
    let user = Keys::new(user);
    let private = CipherString::new(protected_private_key)?.decrypt_unpadded(&user.symmetric()?)?;
    let private = keyward_bw::crypto::parse_private_key(private.data())?;
    let mut orgs = HashMap::new();
    for (id, sealed) in protected_org_keys {
        // Deprecated RSA-with-HMAC (5/6) is read-only compatibility with
        // Bitwarden: the recipient has no symmetric key to verify that MAC.
        // Keep the stored form unchanged; never silently reserialize it.
        let parsed = if sealed.starts_with("5.") || sealed.starts_with("6.") {
            use base64::Engine as _;
            let (kind, rest) = sealed.split_once('.').ok_or_else(|| anyhow::anyhow!("invalid organization key"))?;
            let parts: Vec<_> = rest.split('|').collect();
            if parts.len() != 2 { anyhow::bail!("invalid legacy organization key"); }
            let b64 = base64::engine::general_purpose::STANDARD;
            if b64.decode(parts[1])?.len() != 32 { anyhow::bail!("invalid legacy organization MAC length"); }
            EncString::Asymmetric { ct: b64.decode(parts[0])?, sha256: kind == "5" }
        } else { EncString::parse(sealed)? };
        let raw = Zeroizing::new(parsed.decrypt_rsa(&private)?);
        if raw.len() != 64 { anyhow::bail!("invalid organization key length"); }
        let mut bytes = SecretBytes::new(); bytes.extend(raw.iter().copied())?;
        orgs.insert(id.clone(), Keys::new(bytes));
    }
    Ok((user, orgs))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use keyward_bw::crypto::{EncString, SymmetricKey};
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture {
        email: String,
        password: String,
        iterations: u32,
        user: String,
        org: String,
        item: String,
        plain: String,
        protected_key: String,
        protected_private_key: String,
        protected_org_key: String,
        protected_item_key: String,
        user_cipher: String,
        org_cipher: String,
        item_cipher: String,
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("../tests/fixtures/crypto-compat.json")).unwrap()
    }
    fn decode(value: &str) -> Vec<u8> {
        base64::engine::general_purpose::STANDARD.decode(value).unwrap()
    }
    fn keys(value: &str) -> Keys {
        let mut bytes = SecretBytes::new();
        bytes.extend(decode(value).into_iter()).unwrap();
        Keys::new(bytes)
    }
    fn raw(key: &Keys) -> Vec<u8> {
        [key.enc_key(), key.mac_key()].concat()
    }
    fn unlock_fixture(f: &Fixture, password: &str) -> anyhow::Result<(Keys, HashMap<String, Keys>)> {
        unlock(&f.email, password, Kdf::Pbkdf2 { iterations: f.iterations },
            &f.protected_key, &f.protected_private_key,
            &HashMap::from([("org".into(), f.protected_org_key.clone())]))
    }

    #[test]
    fn node_openssl_golden_ciphertext_decrypts_exact_binary_bytes() {
        let f = fixture();
        // Stable, independent AES-CBC/HMAC vector, not a native round trip.
        assert_eq!(f.user_cipher, "2.8PHy8/T19vf4+fr7/P3+/w==|AEpsc7C7nU5a2R1ts9e16yiLqfldNiOhxT7Rz7979YM=|CX3srZgy4HHtDjSaNz3Lg022WBIDjBFhy0rb/nDZS8M=");
        let user = keys(&f.user);
        let orgs = HashMap::new();
        let ring = crate::read::Ring { user: &user, orgs: &orgs };
        assert_eq!(crate::read::decrypt_raw(&ring, &f.user_cipher).unwrap(), decode(&f.plain));
        let independent = SymmetricKey::from_bytes(&decode(&f.user)).unwrap();
        assert_eq!(EncString::parse(&f.user_cipher).unwrap().decrypt(&independent).unwrap(), decode(&f.plain));
    }

    #[test]
    fn independent_pbkdf2_and_rsa_fixture_unlocks_user_and_organization_keys() {
        let f = fixture();
        let (user, orgs) = unlock_fixture(&f, &f.password).unwrap();
        assert_eq!(raw(&user), decode(&f.user));
        assert_eq!(raw(&orgs["org"]), decode(&f.org));
    }

    #[test]
    fn per_item_key_uses_the_organization_base_and_overrides_it_for_fields() {
        let f = fixture();
        let user = keys(&f.user);
        let orgs = HashMap::from([("org".into(), keys(&f.org))]);
        let ring = crate::read::Ring { user: &user, orgs: &orgs };
        let cipher: keyward_bw::model::Cipher = serde_json::from_value(serde_json::json!({
            "id":"item", "type":1, "organizationId":"org", "key":f.protected_item_key,
        })).unwrap();
        let item = ring.item(&cipher).unwrap();
        assert_eq!(raw(&item), decode(&f.item));
        assert_eq!(CipherString::new(&f.item_cipher).unwrap().decrypt_symmetric(&user, Some(&item)).unwrap(), decode(&f.plain));
        assert!(CipherString::new(&f.item_cipher).unwrap().decrypt_symmetric(&orgs["org"], None).is_err());
        assert_eq!(CipherString::new(&f.org_cipher).unwrap().decrypt_symmetric(&orgs["org"], None).unwrap(), decode(&f.plain));
    }

    #[test]
    fn native_encryption_is_readable_by_the_owned_protocol_implementation() {
        let f = fixture();
        let user = keys(&f.user);
        let independent = SymmetricKey::from_bytes(&decode(&f.user)).unwrap();
        let first = CipherString::encrypt_symmetric(&user, &decode(&f.plain)).unwrap().to_string();
        let second = CipherString::encrypt_symmetric(&user, &decode(&f.plain)).unwrap().to_string();
        assert_ne!(first, second, "production encryption must not reuse the fixture IV");
        for sealed in [first, second] {
            assert_eq!(EncString::parse(&sealed).unwrap().decrypt(&independent).unwrap(), decode(&f.plain));
        }
    }

    #[test]
    fn locked_binary_reads_preserve_validated_padding_for_passkey_callers() {
        let f = fixture();
        let sealed = CipherString::new(&f.user_cipher).unwrap();
        assert_eq!(sealed.symmetric_ciphertext_len(), Some(32));
        let plain = decode(&f.plain);
        let padded = sealed.decrypt_locked_symmetric(&keys(&f.user)).unwrap();
        assert_eq!(&padded.data()[..plain.len()], plain);
        assert_eq!(&padded.data()[plain.len()..], &[5; 5]);
    }

    #[test]
    fn missing_empty_wrong_mac_and_tampered_iv_are_refused_at_the_read_boundary() {
        let f = fixture();
        let user = keys(&f.user);
        let orgs = HashMap::new();
        let ring = crate::read::Ring { user: &user, orgs: &orgs };
        let parts: Vec<_> = f.user_cipher.split('|').collect();
        for bad in [
            format!("{}|{}", parts[0], parts[1]),
            format!("{}|{}|", parts[0], parts[1]),
            format!("{}|{}|{}", parts[0], parts[1], f.user),
            format!("2.AAAAAAAAAAAAAAAAAAAAAA==|{}|{}", parts[1], parts[2]),
            format!("{}|AA==|{}", parts[0], parts[2]),
            format!("2.AA==|{}|{}", parts[1], parts[2]),
            format!("{}|{}|AA==", parts[0], parts[1]),
        ] {
            assert!(crate::read::decrypt_raw(&ring, &bad).is_none());
        }
        assert!(CipherString::new(&f.user_cipher).unwrap().decrypt_symmetric(&keys(&f.org), None).is_err());
        for bad in ["", "/.AA==", "β.AA==", "22.AA==", "4.AA==", "4.AA==|AA==", "6.AA==|AA==", "2.AA==|AA==|AA==|AA=="] {
            assert!(CipherString::new(bad).is_err());
        }
    }

    #[test]
    fn bad_password_protected_material_and_kdf_bounds_fail_before_publication() {
        let mut f = fixture();
        assert!(unlock_fixture(&f, "wrong synthetic password").is_err());
        f.iterations = u32::MAX;
        assert_eq!(unlock_fixture(&f, &f.password).err().unwrap().to_string(), keyward_bw::crypto::KDF_OUT_OF_RANGE);
        f = fixture();
        f.protected_private_key = f.user_cipher.clone();
        assert!(unlock_fixture(&f, &f.password).is_err());
        f = fixture();
        f.protected_org_key = "4.AA==".into();
        assert!(unlock_fixture(&f, &f.password).is_err());
    }

    #[test]
    fn untrusted_inputs_cannot_overflow_the_locked_buffer() {
        let f = fixture();
        let user = keys(&f.user);
        // CBC padding makes these ciphertext lengths exactly 4096 and 4112.
        let full = CipherString::encrypt_symmetric(&user, &vec![7; LOCKED_CAPACITY - 1]).unwrap();
        assert_eq!(full.symmetric_ciphertext_len(), Some(4096));
        let padded = full.decrypt_locked_symmetric(&user).unwrap();
        assert_eq!(padded.data().len(), 4096);
        assert_eq!(&padded.data()[..4095], &vec![7; 4095]);
        let over = CipherString::encrypt_symmetric(&user, &vec![7; LOCKED_CAPACITY]).unwrap();
        assert_eq!(over.symmetric_ciphertext_len(), Some(4112));
        assert!(over.decrypt_locked_symmetric(&user).is_err());
        let mut oversized = fixture();
        oversized.protected_private_key = over.to_string();
        assert!(unlock_fixture(&oversized, &oversized.password).err().unwrap().to_string().contains("capacity"));
        oversized = fixture();
        oversized.protected_key = over.to_string();
        assert!(unlock_fixture(&oversized, &oversized.password).err().unwrap().to_string().contains("capacity"));
        let mut bytes = SecretBytes::new();
        bytes.extend(std::iter::repeat_n(7, LOCKED_CAPACITY)).unwrap();
        assert!(bytes.extend(std::iter::once(8)).is_err());
        assert_eq!(bytes.data().len(), LOCKED_CAPACITY);
        let mut empty = SecretBytes::new();
        assert!(empty.extend(std::iter::repeat_n(7, LOCKED_CAPACITY + 1)).is_err());
        assert!(empty.data().is_empty(), "failed batch extension rolls back and clears the prefix");
        // Passwords are borrowed by KDF primitives, not copied into the fixed
        // buffer; long inputs now report normal authentication failures.
        let err = unlock_fixture(&f, &"x".repeat(LOCKED_CAPACITY + 1)).err().unwrap().to_string();
        assert!(!err.contains("capacity"));
        let err = unlock_fixture(&f, &"x".repeat(LOCKED_CAPACITY)).err().unwrap().to_string();
        assert!(!err.contains("capacity"));
    }

    #[test]
    fn independent_argon2id_fixture_unlocks_the_same_user_and_org_material() {
        let f: Fixture = serde_json::from_str(include_str!("../tests/fixtures/crypto-argon2-compat.json")).unwrap();
        let (user, orgs) = unlock(&f.email, &f.password,
            Kdf::Argon2id { iterations:2, memory_mib:16, parallelism:1 },
            &f.protected_key, &f.protected_private_key,
            &HashMap::from([("org".into(), f.protected_org_key.clone())])).unwrap();
        assert_eq!(raw(&user), decode(&f.user));
        assert_eq!(raw(&orgs["org"]), decode(&f.org));
    }

    #[test]
    fn legacy_rsa_org_keys_are_read_without_rewriting_the_original_form() {
        let mut f = fixture();
        let original = format!("6.{}|{}", f.protected_org_key.strip_prefix("4.").unwrap(),
            base64::engine::general_purpose::STANDARD.encode([0;32]));
        f.protected_org_key = original.clone();
        let (_, orgs) = unlock_fixture(&f, &f.password).unwrap();
        assert_eq!(raw(&orgs["org"]), decode(&f.org));
        assert_eq!(f.protected_org_key, original);
    }

    #[test]
    fn secret_truncation_and_failed_growth_clear_unused_bytes_and_clone_is_independent() {
        let mut bytes = SecretBytes::new(); bytes.extend([1,2,3,4].into_iter()).unwrap();
        let copy = bytes.clone();
        bytes.truncate(2);
        assert_eq!(bytes.data(), &[1,2]);
        assert_eq!(&bytes.data[2..4], &[0,0]);
        assert_eq!(copy.data(), &[1,2,3,4]);
        assert!(bytes.extend(std::iter::repeat_n(9, LOCKED_CAPACITY)).is_err());
        assert_eq!(bytes.data(), &[1,2]);
        assert!(bytes.data[2..].iter().all(|b| *b == 0));
    }

    #[test]
    fn authenticated_but_invalid_key_lengths_are_errors_not_panics_or_base_key_fallback() {
        let f = fixture();
        let master = MasterKey::derive(&f.password, &f.email, Kdf::Pbkdf2 {iterations:f.iterations}).unwrap();
        for len in [0,32,63,65,128] {
            let protected = EncString::encrypt(&master.stretch().unwrap(), &vec![8;len]).unwrap().to_string();
            assert!(unlock(&f.email, &f.password, Kdf::Pbkdf2 {iterations:f.iterations},
                &protected, &f.protected_private_key, &HashMap::new()).is_err());
            let org = keys(&f.org);
            let sealed = CipherString::encrypt_symmetric(&org, &vec![8;len]).unwrap().to_string();
            let orgs = HashMap::from([("org".into(),org)]);
            let user = keys(&f.user);
            let ring = crate::read::Ring {user:&user,orgs:&orgs};
            let item: keyward_bw::model::Cipher = serde_json::from_value(serde_json::json!({
                "id":"item", "organizationId":"org", "key":sealed,
            })).unwrap();
            assert!(ring.item(&item).is_none());
            assert!(crate::read::encrypt_for(&ring,&item,"value").is_err());
        }
    }
}
