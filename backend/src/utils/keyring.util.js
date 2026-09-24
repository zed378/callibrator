/**
 * P6-10 / S-08 — versioned key rings for the secrets the platform encrypts
 * or signs with.
 *
 * A key ring is ONE current key, which every new ciphertext is written under,
 * plus any number of PREVIOUS keys, which are only ever read with. Each key is
 * named by a key id: a non-secret fingerprint of the key itself, so the same
 * key has the same id on every replica and in every script, with nothing to
 * configure or keep in step. A ciphertext that carries the id is decrypted
 * with exactly that key; rotation is:
 *
 *   1. set the new key as current and the old one as previous — both decrypt;
 *   2. re-wrap every stored value under the current key (scripts/rotateKeys.js);
 *   3. remove the previous key once the re-wrap reports nothing left under it.
 *
 * The runbook is docs/SECURITY/13-KEY-ROTATION.md.
 */
const crypto = require("crypto");

/** Domain separation, so a key id can never equal any other hash of the key. */
const KEY_ID_CONTEXT = "callibrator-key-id:v1:";

/**
 * @param {Buffer} key
 * @returns {string} the key's id — 16 hex characters of a SHA-256 fingerprint
 */
const keyIdOf = (key) =>
  crypto.createHash("sha256").update(KEY_ID_CONTEXT).update(key).digest("hex").slice(0, 16);

/**
 * Split a list of previous keys: comma- or whitespace-separated, blanks
 * ignored.
 *
 * @param {string|undefined} raw
 * @returns {string[]}
 */
const splitKeyList = (raw) =>
  (raw || "")
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter(Boolean);

/**
 * Build a ring from key buffers.
 *
 * @param {Buffer} current - the key new ciphertexts are written under
 * @param {Buffer[]} [previous] - keys still accepted for reading
 * @returns {{currentId: string, current: Buffer, keys: Map<string, Buffer>, previousIds: string[]}}
 */
const buildKeyring = (current, previous = []) => {
  const currentId = keyIdOf(current);
  const keys = new Map([[currentId, current]]);
  const previousIds = [];
  for (const key of previous) {
    const id = keyIdOf(key);
    if (!keys.has(id)) {
      keys.set(id, key);
      previousIds.push(id);
    }
  }
  return { currentId, current, keys, previousIds };
};

module.exports = { keyIdOf, splitKeyList, buildKeyring, KEY_ID_CONTEXT };
