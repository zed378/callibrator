/**
 * P6-10 / S-08 — utils/keyring.util.js. Real crypto: a key id is a function
 * of the key alone, so every replica and every script agrees on it.
 */
const crypto = require("crypto");
const { keyIdOf, splitKeyList, buildKeyring, KEY_ID_CONTEXT } = require("../../utils/keyring.util");

const A = Buffer.alloc(32, 1);
const B = Buffer.alloc(32, 2);

describe("keyIdOf", () => {
  it("is 16 hex characters of a domain-separated SHA-256 — stable, and not the key", () => {
    const expected = crypto.createHash("sha256").update(KEY_ID_CONTEXT).update(A).digest("hex").slice(0, 16);
    expect(keyIdOf(A)).toBe(expected);
    expect(keyIdOf(Buffer.from(A))).toBe(expected);
    expect(keyIdOf(A)).not.toBe(keyIdOf(B));
    // Not simply the start of sha256(key): the context separates it.
    expect(keyIdOf(A)).not.toBe(crypto.createHash("sha256").update(A).digest("hex").slice(0, 16));
  });
});

describe("splitKeyList", () => {
  it.each([
    [undefined, []],
    ["", []],
    ["k1", ["k1"]],
    ["k1,k2", ["k1", "k2"]],
    [" k1 ,\n k2  k3 ,, ", ["k1", "k2", "k3"]],
  ])("%p -> %p", (raw, list) => {
    expect(splitKeyList(raw)).toEqual(list);
  });
});

describe("buildKeyring", () => {
  it("one key: current only", () => {
    const ring = buildKeyring(A);
    expect(ring.currentId).toBe(keyIdOf(A));
    expect(ring.current).toBe(A);
    expect([...ring.keys.keys()]).toEqual([keyIdOf(A)]);
    expect(ring.previousIds).toEqual([]);
  });

  it("previous keys are readable by id; a duplicate of the current key is not listed twice", () => {
    const ring = buildKeyring(B, [A, B, A]);
    expect(ring.currentId).toBe(keyIdOf(B));
    expect(ring.previousIds).toEqual([keyIdOf(A)]);
    expect(ring.keys.get(keyIdOf(A))).toBe(A);
    expect(ring.keys.size).toBe(2);
  });
});
