// Synthetic native-vault compatibility fixture, produced independently with
// Node/OpenSSL rather than either Rust implementation. Run explicitly and
// review the JSON when updating the checked-in fixture. RSA generation means
// regenerated ciphertext differs; no real accounts or keys are read.
import {createCipheriv, createHmac, createHash, pbkdf2Sync, argon2Sync, generateKeyPairSync, publicEncrypt, constants} from 'node:crypto';

const b64 = bytes => bytes.toString('base64');
const bytes = (length, offset) => Buffer.from(Array.from({length}, (_, i) => (i + offset) & 255));
const user = bytes(64, 0), org = bytes(64, 64), item = bytes(64, 128);
const iv = bytes(16, 240);
const seal = (key, plain) => {
  const cipher = createCipheriv('aes-256-cbc', key.subarray(0, 32), iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const mac = createHmac('sha256', key.subarray(32)).update(iv).update(ct).digest();
  return `2.${b64(iv)}|${b64(ct)}|${b64(mac)}`;
};
const email = 'compat@example.test', password = 'Synthetic passphrase ✓ 123!', iterations = 100000;
const argon = process.argv.includes('--argon2');
const master = argon
  ? argon2Sync('argon2id', {message: password, nonce: createHash('sha256').update(email).digest(), passes: 2, memory: 16384, parallelism: 1, tagLength: 32})
  : pbkdf2Sync(password, email, iterations, 32, 'sha256');
const expand = info => createHmac('sha256', master).update(info).update(Buffer.from([1])).digest();
const stretched = Buffer.concat([expand('enc'), expand('mac')]);
const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const privateDer = privateKey.export({type: 'pkcs8', format: 'der'});
const wrappedOrg = publicEncrypt({key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1'}, org);
const plain = Buffer.concat([Buffer.from('Keyward compatibility\0'), Buffer.from([0, 255, 128, 13, 10])]);
console.log(JSON.stringify({
  provenance: 'Synthetic Node/OpenSSL PBKDF2-SHA256 or Argon2id, HKDF-expand, AES-CBC/PKCS7, HMAC-SHA256 and RSA-OAEP-SHA1; fixed IV only for test vectors.',
  email, password, iterations: argon ? 2 : iterations, ...(argon ? {memoryMiB:16, parallelism:1} : {}),
  user: b64(user), org: b64(org), item: b64(item), plain: b64(plain),
  protectedKey: seal(stretched, user), protectedPrivateKey: seal(user, privateDer),
  protectedOrgKey: `4.${b64(wrappedOrg)}`, protectedItemKey: seal(org, item),
  userCipher: seal(user, plain), orgCipher: seal(org, plain), itemCipher: seal(item, plain),
}, null, 2));
