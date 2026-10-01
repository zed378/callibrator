/**
 * P10-16 (ADR-099) — the first super admin's one-time password: how it is
 * drawn, and the one place its plaintext is ever put.
 *
 * THE OWNER'S RULE: the value is visible only inside the container. It never
 * reaches stdout/stderr (`docker logs` reads those from the host), an API or
 * seed response, the audit log, the database (the hash only) or the
 * environment. It is written to a mode-0600 file at a path that is not a bind
 * mount or a volume, and read with
 *   docker exec <backend-container> cat /app/.bootstrap/superadmin-password
 *
 * The path is `storagePath(".bootstrap", "superadmin-password")`:
 *   - image:     /app/.bootstrap/superadmin-password (APP_STORAGE_PATH=/app;
 *                the directory is created app:app 0700 by backend/Dockerfile,
 *                and neither compose nor Helm mounts anything there);
 *   - local tsx: backend/.bootstrap/superadmin-password (gitignored).
 *
 * Nothing here logs. The callers log a pointer (`bootstrapPointer`), never the
 * value.
 */
// Named imports: each call reads the fs function at call time, so a spy on the
// module reaches it (a namespace import is a snapshot under the jest transform).
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { randomInt } from "crypto";
import storagePath from "./storagePath.util";

/** Unambiguous character classes: no 0 O o, 1 l I i. */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";
/** Shell- and URL-quiet symbols, so a copy-paste survives a terminal. */
const SYMBOLS = "-_.@+=";

const CLASSES: readonly string[] = Object.freeze([UPPER, LOWER, DIGITS, SYMBOLS]);
const ALPHABET = CLASSES.join("");

/** ≥ 20 required by the owner; 24 × log2(60) ≈ 141 bits before the class constraint. */
const BOOTSTRAP_PASSWORD_LENGTH = 24;

/** The characters a bootstrap password is never drawn from. */
const AMBIGUOUS = "0Oo1lIi";

/** One character of `set`, uniformly, from the CSPRNG. */
const pick = (set: string): string => set.charAt(randomInt(set.length));

/**
 * A fresh one-time password: BOOTSTRAP_PASSWORD_LENGTH characters, at least one
 * of each class, every draw and the shuffle from `crypto.randomInt`.
 */
const generateBootstrapPassword = (): string => {
  const chars = CLASSES.map(pick);
  while (chars.length < BOOTSTRAP_PASSWORD_LENGTH) {
    chars.push(pick(ALPHABET));
  }
  // A uniform random permutation (draw without replacement), so the
  // guaranteed characters are not always at the front.
  const shuffled: string[] = [];
  while (chars.length > 0) {
    shuffled.push(...chars.splice(randomInt(chars.length), 1));
  }
  return shuffled.join("");
};

/** Where the plaintext lives until it is consumed. */
const bootstrapSecretPath = (): string => storagePath(".bootstrap", "superadmin-password");

const isErrno = (err: unknown, code: string): boolean =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;

/** Remove the file; a file that is not there is already removed. */
const removeBootstrapSecret = (): boolean => {
  try {
    unlinkSync(bootstrapSecretPath());
    return true;
  } catch (err) {
    if (isErrno(err, "ENOENT")) {
      return false;
    }
    throw err;
  }
};

/**
 * Write the plaintext, and nothing else, to the file: owner-only (0600) in an
 * owner-only directory (0700). An existing file is removed first and the new
 * one created exclusively (`wx`), so a file or link planted at the path is
 * never written through; the explicit chmod makes the mode exact whatever the
 * umask.
 *
 * @returns the path written
 */
const writeBootstrapSecret = (password: string): string => {
  const file = bootstrapSecretPath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  removeBootstrapSecret();
  writeFileSync(file, `${password}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);
  return file;
};

/** Whether the file exists (the boot sweep's question). */
const bootstrapSecretExists = (): boolean => existsSync(bootstrapSecretPath());

/** The one line the operator is shown: where to look, never what is there. */
const bootstrapPointer = (identifier: string, file: string): string =>
  `One-time password for ${identifier} written to ${file} inside the container (host ${os.hostname()}); ` +
  `read it with: docker exec <backend-container> cat ${file}`;

export {
  ALPHABET,
  AMBIGUOUS,
  CLASSES,
  BOOTSTRAP_PASSWORD_LENGTH,
  generateBootstrapPassword,
  bootstrapSecretPath,
  writeBootstrapSecret,
  removeBootstrapSecret,
  bootstrapSecretExists,
  bootstrapPointer,
};
