/**
 * P22-10b — record encryption for the field store (P19-08 § 7.1; ADR-127 § 4; `06` § 4, web adapter).
 *
 * Every record's payload is AES-GCM-256 under the user's key — a `CryptoKey` made with
 * `extractable: false` (never exported; kept, as a structured-cloneable key, in the same database) —
 * with a fresh 96-bit IV and the record's SLOT as additional authenticated data
 * (`"<store>/<record key>/<schemaVersion>"`): a ciphertext copied into another slot fails to decrypt.
 *
 * What this protects: a copy of the profile (a backup, an image of a powered-off phone). What it does
 * not: anyone using the unlocked phone, or same-origin script (FT-86, FT-88) — the residuals ADR-127
 * accepted. No key is derived from a password; there is no PIN.
 */

/** The WebCrypto the adapter uses (the browser's, or node's in tests). */
export interface CryptoDeps {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

export const SCHEMA_VERSION = 1;

/** A sealed payload as stored (both parts are structured-cloneable). */
export interface Sealed {
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly ct: ArrayBuffer;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The slot a record is bound to. */
export const slotOf = (store: string, key: string): string => `${store}/${key}/${String(SCHEMA_VERSION)}`;

/** A new, NON-extractable AES-GCM-256 key. */
export const newKey = (c: CryptoDeps): Promise<CryptoKey> =>
  c.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) as Promise<CryptoKey>;

export const sealBytes = async (c: CryptoDeps, key: CryptoKey, slot: string, bytes: ArrayBuffer): Promise<Sealed> => {
  const iv = c.getRandomValues(new Uint8Array(12));
  const ct = await c.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(slot) }, key, bytes);
  return { iv, ct };
};

export const openBytes = (c: CryptoDeps, key: CryptoKey, slot: string, sealed: Sealed): Promise<ArrayBuffer> =>
  c.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv, additionalData: encoder.encode(slot) }, key, sealed.ct);

/** A JSON value sealed into its slot. */
export const seal = (c: CryptoDeps, key: CryptoKey, slot: string, value: unknown): Promise<Sealed> =>
  sealBytes(c, key, slot, encoder.encode(JSON.stringify(value)).buffer as ArrayBuffer);

/** The JSON value of a sealed slot (rejects when the slot or the key is not the one it was sealed with). */
export const open = async <T>(c: CryptoDeps, key: CryptoKey, slot: string, sealed: Sealed): Promise<T> =>
  JSON.parse(decoder.decode(await openBytes(c, key, slot, sealed))) as T;
