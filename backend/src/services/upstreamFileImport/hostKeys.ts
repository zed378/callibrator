/**
 * SSH host keys for the rsync image import: parse `ssh-keyscan` output and compute the
 * fingerprint the operator confirms (trust on first use, confirmed by a person — never
 * accepted silently).
 *
 * The fingerprint is OpenSSH's own form: `SHA256:` + unpadded base64 of the SHA-256 of the key
 * blob — what `ssh-keygen -lf` prints and what an operator reads off the source server with
 * `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` to compare. Computed here, so no
 * `ssh-keygen` run is needed.
 */
import { createHash } from "crypto";

/** The key types accepted, strongest first (the order a pin is suggested in). */
export const ACCEPTED_KEY_TYPES = Object.freeze([
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "ssh-rsa",
] as const);

/** A host key as scanned. */
export interface ScannedHostKey {
  type: string;
  key: string;
  fingerprint: string;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,3}$/;

/** OpenSSH's SHA256 fingerprint of a base64 key blob. */
export const fingerprintOf = (keyBase64: string): string =>
  `SHA256:${createHash("sha256").update(Buffer.from(keyBase64, "base64")).digest("base64").replace(/=+$/, "")}`;

/** The form a confirmed fingerprint must have (43 base64 characters after the prefix). */
export const FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

/**
 * The keys in `ssh-keyscan` output: one per `<host> <type> <base64>` line of an accepted type,
 * each type once, strongest first. Comment lines and anything malformed are ignored.
 */
export const parseKeyscan = (stdout: string): ScannedHostKey[] => {
  const byType = new Map<string, ScannedHostKey>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    const type = parts[1];
    const key = parts[2];
    if (parts.length < 3 || type === undefined || key === undefined) {
      continue;
    }
    if (!(ACCEPTED_KEY_TYPES as readonly string[]).includes(type) || !BASE64.test(key) || byType.has(type)) {
      continue;
    }
    byType.set(type, { type, key, fingerprint: fingerprintOf(key) });
  }
  return ACCEPTED_KEY_TYPES.flatMap((type) => {
    const found = byType.get(type);
    return found ? [found] : [];
  });
};
