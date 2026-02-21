/**
 * Sigil Core - Cryptographic primitives
 * 
 * Ed25519 keypairs, signing, verification, hashing.
 * Zero dependencies - uses Node.js built-in crypto.
 */

import { generateKeyPairSync, sign, verify, createHash, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// Default paths
const SIEGEL_DIR = join(homedir(), '.siegel');
const KEYS_DIR = join(SIEGEL_DIR, 'keys');

/**
 * Generate a new Ed25519 keypair
 * @returns {{ publicKey: Buffer, privateKey: Buffer }}
 */
export function generateKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });
  return { publicKey, privateKey };
}

/**
 * Sign data with a private key
 * @param {Buffer|string} data - Data to sign
 * @param {Buffer} privateKey - Ed25519 private key (DER format)
 * @returns {Buffer} Signature
 */
export function signData(data, privateKey) {
  const keyObject = {
    key: privateKey,
    format: 'der',
    type: 'pkcs8'
  };
  return sign(null, Buffer.from(data), keyObject);
}

/**
 * Verify a signature
 * @param {Buffer|string} data - Original data
 * @param {Buffer} signature - Signature to verify
 * @param {Buffer} publicKey - Ed25519 public key (DER format)
 * @returns {boolean} True if valid
 */
export function verifySignature(data, signature, publicKey) {
  const keyObject = {
    key: publicKey,
    format: 'der',
    type: 'spki'
  };
  return verify(null, Buffer.from(data), keyObject, signature);
}

/**
 * Hash data using SHA-256
 * @param {Buffer|string} data - Data to hash
 * @returns {string} Hex-encoded hash
 */
export function hash(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a random ID
 * @param {number} bytes - Number of random bytes (default 16)
 * @returns {string} Hex-encoded ID
 */
export function randomId(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}

/**
 * Identity management - create, load, save keypairs
 */
export class Identity {
  constructor(publicKey, privateKey, metadata = {}) {
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.metadata = metadata;
    this.id = hash(publicKey).slice(0, 16); // Short ID from pubkey hash
  }

  /**
   * Create a new identity
   * @param {object} metadata - Optional metadata (name, created, etc.)
   * @returns {Identity}
   */
  static create(metadata = {}) {
    const { publicKey, privateKey } = generateKeypair();
    return new Identity(publicKey, privateKey, {
      created: new Date().toISOString(),
      ...metadata
    });
  }

  /**
   * Load identity from disk
   * @param {string} name - Identity name (default: 'default')
   * @param {string} dir - Keys directory
   * @returns {Identity}
   */
  static load(name = 'default', dir = KEYS_DIR) {
    const basePath = join(dir, name);
    const publicKey = readFileSync(`${basePath}.pub`);
    const privateKey = readFileSync(`${basePath}.key`);
    const metadata = existsSync(`${basePath}.json`)
      ? JSON.parse(readFileSync(`${basePath}.json`, 'utf8'))
      : {};
    return new Identity(publicKey, privateKey, metadata);
  }

  /**
   * Check if identity exists on disk
   * @param {string} name - Identity name
   * @param {string} dir - Keys directory
   * @returns {boolean}
   */
  static exists(name = 'default', dir = KEYS_DIR) {
    const basePath = join(dir, name);
    return existsSync(`${basePath}.pub`) && existsSync(`${basePath}.key`);
  }

  /**
   * Save identity to disk
   * @param {string} name - Identity name (default: 'default')
   * @param {string} dir - Keys directory
   */
  save(name = 'default', dir = KEYS_DIR) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const basePath = join(dir, name);
    writeFileSync(`${basePath}.pub`, this.publicKey, { mode: 0o644 });
    writeFileSync(`${basePath}.key`, this.privateKey, { mode: 0o600 });
    writeFileSync(`${basePath}.json`, JSON.stringify(this.metadata, null, 2), { mode: 0o644 });
  }

  /**
   * Sign data with this identity
   * @param {Buffer|string} data - Data to sign
   * @returns {Buffer} Signature
   */
  sign(data) {
    return signData(data, this.privateKey);
  }

  /**
   * Verify a signature against this identity's public key
   * @param {Buffer|string} data - Original data
   * @param {Buffer} signature - Signature to verify
   * @returns {boolean}
   */
  verify(data, signature) {
    return verifySignature(data, signature, this.publicKey);
  }

  /**
   * Export public identity (safe to share)
   * @returns {object}
   */
  toPublic() {
    return {
      id: this.id,
      publicKey: this.publicKey.toString('base64'),
      metadata: this.metadata
    };
  }
}

export default {
  generateKeypair,
  signData,
  verifySignature,
  hash,
  randomId,
  Identity
};
