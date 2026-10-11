// The kind named by an OpenSSH public key, in the person's words.
const ALGORITHM_WORDS: Readonly<Record<string, string>> = {
  "ssh-ed25519": "Ed25519",
  "ssh-rsa": "RSA",
  "ecdsa-sha2-nistp256": "ECDSA P-256",
  "ecdsa-sha2-nistp384": "ECDSA P-384",
  "ecdsa-sha2-nistp521": "ECDSA P-521",
  "sk-ssh-ed25519@openssh.com": "Ed25519 (FIDO)",
  "sk-ecdsa-sha2-nistp256@openssh.com": "ECDSA (FIDO)",
};
export function algorithmOf(publicKey: string): string | null {
  const kind = publicKey.trim().split(/\s+/)[0] ?? "";
  return ALGORITHM_WORDS[kind] ?? (kind || null);
}
