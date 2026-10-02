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
 *   2. re-wrap every stored value under the current key (scripts/rotateKeys.ts);
 *   3. remove the previous key once the re-wrap reports nothing left under it.
 *
 * The runbook is docs/SECURITY/13-KEY-ROTATION.md.
 *
 * P9-09 (ADR-087): converted from keyring.util.js with no behaviour change.
 */
import { createHash } from "crypto";

/** Domain separation, so a key id can never equal any other hash of the key. */
const KEY_ID_CONTEXT = "callibrator-key-id:v1:";

/** A ring: the current key, every key by id, and the ids of the previous ones. */
export interface Keyring {
  currentId: string;
  current: Buffer;
  keys: Map<string, Buffer>;
  previousIds: string[];
}

/**
 * @returns the key's id — 16 hex characters of a SHA-256 fingerprint
 */
const keyIdOf = (key: Buffer): string =>
  createHash("sha256").update(KEY_ID_CONTEXT).update(key).digest("hex").slice(0, 16);

/**
 * Split a list of previous keys: comma- or whitespace-separated, blanks
 * ignored.
 */
const splitKeyList = (raw: string | undefined): string[] =>
  // `||`, not `??`: an empty string and undefined both mean "no keys", as before.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as-built (ADR-038 rule 3)
  (raw || "")
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter(Boolean);

/**
 * Build a ring from key buffers.
 *
 * @param current - the key new ciphertexts are written under
 * @param previous - keys still accepted for reading
 */
const buildKeyring = (current: Buffer, previous: readonly Buffer[] = []): Keyring => {
  const currentId = keyIdOf(current);
  const keys = new Map<string, Buffer>([[currentId, current]]);
  const previousIds: string[] = [];
  for (const key of previous) {
    const id = keyIdOf(key);
    if (!keys.has(id)) {
      keys.set(id, key);
      previousIds.push(id);
    }
  }
  return { currentId, current, keys, previousIds };
};

export { keyIdOf, splitKeyList, buildKeyring, KEY_ID_CONTEXT };
