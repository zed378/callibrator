/**
 * The rsync image import's request schemas (super admin only; ADR-130).
 *
 * Kept here rather than in `@callibrator/contracts`: the frontend reads the generated OpenAPI
 * types, and the rules are this server's (what its ssh/rsync invocation can safely take).
 *
 * Every value that reaches an argument vector is held to a narrow alphabet HERE, and the vector
 * builder puts it after `--` THERE (services/upstreamFileImport/sshArgs.ts) — two independent
 * layers between an operator's typing and an option or a shell:
 *   host      a DNS name (labels of letters, digits, hyphens; no leading hyphen) or an IP literal
 *   username  POSIX-portable: a letter or underscore first, then letters, digits, `.`, `_`, `-`
 *   path      absolute, segments of letters, digits and `. _ - @ +`, no `.`/`..` segment,
 *             no whitespace, no quote, no shell metacharacter
 * The password is opaque (any printable text) — it never reaches an argument vector, only
 * sshpass's environment. A private key must be an unencrypted PEM/OpenSSH private key block.
 */
import net from "net";
import { z } from "zod";
import { UPSTREAM_AUTH_METHODS, UPSTREAM_FILE_CLASS_NAMES } from "../constants/upstreamFileImport";
import { FINGERPRINT_PATTERN } from "../services/upstreamFileImport/hostKeys";

const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;
const USERNAME = /^[A-Za-z_][A-Za-z0-9._-]{0,31}$/;
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/;
const PRIVATE_KEY = /^-----BEGIN (OPENSSH|RSA|EC) PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n:,-]+\r?\n-----END \1 PRIVATE KEY-----\s*$/;

/** A host name or an IP literal, lower-cased; never anything an option parser could read. */
export const sourceHost = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform((h) => h.toLowerCase())
  .refine((h) => net.isIP(h) !== 0 || HOSTNAME.test(h), { error: "Enter a host name or an IP address" })
  .meta({ description: "The source server: a DNS name or an IP address", example: "upstream.example.org" });

/** An absolute remote directory, normalised (no trailing slash). */
export const remotePath = z
  .string()
  .trim()
  .min(2)
  .max(1024)
  .refine(
    (p) => {
      if (!p.startsWith("/")) {
        return false;
      }
      const segments = p.split("/").slice(1).filter((s, i, all) => !(s === "" && i === all.length - 1));
      return segments.length > 0 && segments.every((s) => s !== "." && s !== ".." && PATH_SEGMENT.test(s));
    },
    { error: "Enter an absolute path of letters, digits and . _ - @ + (no spaces, no '..')" },
  )
  .transform((p) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p))
  .meta({
    description: "The upstream `public/uploads` directory; each file class is one folder under it",
    example: "/var/www/app/public/uploads",
  });

const password = z
  .string()
  .min(1)
  .max(1024)
  // eslint-disable-next-line no-control-regex -- the point: refuse NUL, CR and LF (sshpass sends the variable as one line)
  .refine((p) => !/[\u0000\r\n]/.test(p), { error: "The password cannot contain a line break" })
  .meta({ description: "SSH password (auth `password`). Write-only: never stored in clear, logged or returned" });

const privateKey = z
  .string()
  .max(16_384)
  .refine((k) => PRIVATE_KEY.test(k.trim()), { error: "Paste an OpenSSH or PEM private key block" })
  .refine((k) => !k.includes("ENCRYPTED"), { error: "The key must not be passphrase-protected" })
  .meta({ description: "Unencrypted SSH private key (auth `key`, recommended). Write-only: never stored in clear, logged or returned" });

/** The fields of a source, shared by check and start. */
const sourceShape = {
  host: sourceHost,
  port: z.number().int().min(1).max(65_535).default(22).meta({ example: 22 }),
  username: z
    .string()
    .trim()
    .regex(USERNAME, { error: "Enter a user name: a letter or _ first, then letters, digits, . _ -" })
    .meta({ example: "importer" }),
  authMethod: z.enum(UPSTREAM_AUTH_METHODS).meta({ description: "`key` is recommended" }),
  password: password.optional(),
  privateKey: privateKey.optional(),
  remotePath,
  fileClasses: z
    .array(z.enum(UPSTREAM_FILE_CLASS_NAMES))
    .min(1)
    .max(UPSTREAM_FILE_CLASS_NAMES.length)
    .refine((list) => new Set(list).size === list.length, { error: "Each file class once" })
    .meta({
      description:
        "`front` = foto_depan, `serial` = foto_sn. Certificate PDFs are never imported (archive-only, owner rule 2026-10-07)",
      example: ["front", "serial"],
    }),
  syntheticSource: z
    .boolean()
    .default(false)
    .meta({ description: "The source holds synthetic test data. Required (with an allow-listed host) while UPSTREAM_REAL_DATA_ALLOWED is false" }),
};

/** The credential matches the method: a password for `password`, a key for `key`, never both. */
const credentialMatches = (value: { authMethod: string; password?: string | undefined; privateKey?: string | undefined }, ctx: z.RefinementCtx): void => {
  if (value.authMethod === "password" && (value.password === undefined || value.privateKey !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["password"], message: "Password authentication takes a password (and no key)" });
  }
  if (value.authMethod === "key" && (value.privateKey === undefined || value.password !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["privateKey"], message: "Key authentication takes a private key (and no password)" });
  }
};

const fingerprint = z
  .string()
  .trim()
  .regex(FINGERPRINT_PATTERN, { error: "A fingerprint looks like SHA256: followed by 43 characters" })
  .meta({ description: "The host-key fingerprint the operator confirmed", example: "SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU" });

/** `POST /admin/upstream-file-imports/check-connection`. Without a fingerprint: scan the host keys only. */
export const checkConnectionSchema = z
  .object({ ...sourceShape, confirmedFingerprint: fingerprint.optional() })
  .superRefine(credentialMatches)
  .meta({ description: "A source to check. Without `confirmedFingerprint` only the host keys are read (no login)" });

/** `POST /admin/upstream-file-imports`. */
export const startImportSchema = z
  .object({
    ...sourceShape,
    confirmedFingerprint: fingerprint,
    targetTenantId: z.guid().meta({ description: "The tenant whose storage receives the photos" }),
    bandwidthLimitKbps: z
      .number()
      .int()
      .min(64)
      .max(1_000_000)
      .nullish()
      .meta({ description: "rsync --bwlimit, in KiB/s; empty for none", example: 20_480 }),
  })
  .superRefine(credentialMatches);

/** `GET /admin/upstream-file-imports`. */
export const listImportsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** `:id` routes. */
export const importIdSchema = z.object({ id: z.guid() });

export type CheckConnectionInput = z.infer<typeof checkConnectionSchema>;
export type StartImportInput = z.infer<typeof startImportSchema>;
export type ListImportsInput = z.infer<typeof listImportsSchema>;
