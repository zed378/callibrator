/**
 * U-09 — the storage request path against a RUNNING backend whose storage is
 * a real S3-compatible server. Run by scripts/storage/s3-live-check.sh (which
 * starts the server, PostgreSQL 18, Redis and the backend); it can also be run
 * by hand against any backend whose platform storage is S3:
 *
 *   node --import tsx scripts/storage/s3-app-path-check.ts
 *
 * Environment (all required unless a default is shown):
 *   API                  backend base, e.g. http://127.0.0.1:5909/api/v1
 *   ADMIN_EMAIL          a super admin (sys@mail.com)
 *   ADMIN_PASSWORD       its password — or BOOTSTRAP_PASSWORD_FILE, the
 *                        one-time password file; the check then completes the
 *                        first sign-in and sets ADMIN_NEW_PASSWORD
 *   S3_ADMIN_ENDPOINT    the server as THIS script reaches it (http://127.0.0.1:18333)
 *   S3_TENANT_ENDPOINT   the server as a TENANT would name it — a host that
 *                        resolves to a private address and is on the backend's
 *                        SSRF_DEV_ALLOW_HOSTS (http://host.docker.internal:18333)
 *   S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION (us-east-1)
 *   PLATFORM_BUCKET      the backend's STORAGE_S3_BUCKET
 *   SIGN_SECRET          the backend's ATTACHMENT_URL_SECRET (mints /storage/object tokens)
 *   BACKEND_DIR          backend/ (the migration CLI runs there, with this environment)
 *   MFA_STATE_FILE       where the super admin's TOTP secret is kept between runs
 *
 * Prints one line per check and exits 1 on the first failure. It changes the
 * signed-in tenant's storage settings and clears them again at the end.
 */
import { spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const API = need("API");
const REGION = process.env["S3_REGION"] ?? "us-east-1";
const ACCESS = need("S3_ACCESS_KEY");
const SECRET = need("S3_SECRET_KEY");
const TENANT_ENDPOINT = need("S3_TENANT_ENDPOINT");
const PLATFORM_BUCKET = need("PLATFORM_BUCKET");
const SIGN_SECRET = need("SIGN_SECRET");
const TENANT_BUCKET = `u09-tenant-${crypto.randomBytes(3).toString("hex")}`;

const s3 = new S3Client({
  region: REGION,
  endpoint: need("S3_ADMIN_ENDPOINT"),
  forcePathStyle: true,
  credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
});

let passed = 0;
const check = (name: string, ok: boolean, detail: unknown = ""): void => {
  if (!ok) {
    console.error(`FAIL  ${name}  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`ok    ${name}`);
};

interface Envelope { success?: boolean; status?: number; message?: string; data?: Record<string, unknown>; token?: string }

const call = async (method: string, path: string, token: string | null, body?: unknown): Promise<{ status: number; body: Envelope; text: string }> => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: Envelope = {};
  try { parsed = JSON.parse(text) as Envelope; } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
};

const signIn = async (): Promise<string> => {
  const email = need("ADMIN_EMAIL");
  const file = process.env["BOOTSTRAP_PASSWORD_FILE"];
  if (file && fs.existsSync(file)) {
    const oneTime = fs.readFileSync(file, "utf8").trim();
    const first = await call("POST", "/auth/login", null, { email, password: oneTime });
    const changed = await call("POST", "/auth/first-sign-in/password", null, {
      token: first.body.token,
      newPassword: need("ADMIN_NEW_PASSWORD"),
    });
    check("first sign-in password set", changed.status === 200, changed.body.message);
  }
  const password = process.env["ADMIN_PASSWORD"] ?? need("ADMIN_NEW_PASSWORD");
  let login = await call("POST", "/auth/login", null, { email, password });
  // A super admin must hold MFA: enrol once (the secret is kept in
  // MFA_STATE_FILE so a re-run can sign in), then sign in with a code.
  const stateFile = need("MFA_STATE_FILE");
  let lastStep = -1;
  const code = (secret: string): string => {
    const step = Math.max(Math.floor(Date.now() / 30000), lastStep + 1);
    lastStep = step;
    return totpAt(secret, step);
  };
  if (login.body.data?.["mfaEnrolmentRequired"] && login.body.token) {
    const setup = await call("POST", "/auth/mfa/setup", login.body.token, {});
    const secret = String(setup.body.data?.["secret"] ?? "");
    fs.writeFileSync(stateFile, secret, { mode: 0o600 });
    const verified = await call("POST", "/auth/mfa/verify", login.body.token, { code: code(secret) });
    check("MFA enrolled", verified.status === 200, verified.body.message);
    login = await call("POST", "/auth/login", null, { email, password });
  }
  if (login.body.data?.["mfaRequired"] && login.body.token) {
    login = await call("POST", "/auth/mfa/login", null, { token: login.body.token, code: code(fs.readFileSync(stateFile, "utf8")) });
  }
  check("signed in", login.status === 200 && typeof login.body.token === "string", login.body.message);
  return login.body.token as string;
};

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), as src/tests/e2e/setup.js computes it. */
const totpAt = (secret: string, step: number): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", bytes).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0xf;
  const value = (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(value % 1000000).padStart(6, "0");
};

const sign = (key: string, ttlSec: number): string => {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac("sha256", SIGN_SECRET).update(`${key}.${String(exp)}`).digest("hex");
  return `${String(exp)}.${sig}`;
};

const objectUrl = (key: string, token: string): string =>
  `${API}/storage/object?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;

const sha256 = (buf: Buffer): string => crypto.createHash("sha256").update(buf).digest("hex");

const main = async (): Promise<void> => {
  for (const bucket of [TENANT_BUCKET, PLATFORM_BUCKET]) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err) {
      if (!/BucketAlready/.test((err as Error).name)) {throw err;}
    }
  }

  const token = await signIn();
  const me = await call("POST", "/auth/verify", token);
  const tenantId = String((me.body.data ?? {})["tenantId"] ?? "");
  check("the signed-in tenant is known", /^[0-9a-f-]{36}$/.test(tenantId), me.body);

  // ---- platform default (operator endpoint, from env) -------------------
  await call("DELETE", "/storage/settings", token);
  const def = await call("GET", "/storage/settings", token);
  check("GET /storage/settings — platform default", def.status === 200 && def.body.data?.["usingPlatformDefault"] === true, def.body);
  const defTest = await call("POST", "/storage/settings/test", token);
  check("POST /storage/settings/test — platform S3 reachable", defTest.status === 200 && defTest.body.data?.["ok"] === true, defTest.body);

  // ---- a tenant's own bucket: refusals --------------------------------
  const base = { provider: "s3", bucket: TENANT_BUCKET, region: REGION, endpoint: TENANT_ENDPOINT, forcePathStyle: true, accessKeyId: ACCESS, secretAccessKey: SECRET };
  const loopback = new URL(TENANT_ENDPOINT);
  loopback.hostname = "127.0.0.1";
  const ssrf = await call("PUT", "/storage/settings", token, { ...base, endpoint: loopback.toString() });
  check("PUT /storage/settings — tenant loopback endpoint refused (400, SSRF guard)", ssrf.status === 400, ssrf.body);

  const badCreds = await call("PUT", "/storage/settings", token, { ...base, secretAccessKey: `${SECRET}-wrong` });
  check("PUT /storage/settings — wrong secret refused (422, server's reason)", badCreds.status === 422 && /^Storage connection test failed: \S/.test(badCreds.body.message ?? ""), badCreds.body);

  const noBucket = await call("PUT", "/storage/settings", token, { ...base, bucket: `${TENANT_BUCKET}-absent` });
  check("PUT /storage/settings — missing bucket refused (422)", noBucket.status === 422, noBucket.body);

  const stillDefault = await call("GET", "/storage/settings", token);
  check("a refused save persisted nothing", stillDefault.body.data?.["usingPlatformDefault"] === true, stillDefault.body);

  // ---- a tenant's own bucket: saved ------------------------------------
  const saved = await call("PUT", "/storage/settings", token, base);
  check("PUT /storage/settings — live-probed and saved (200)", saved.status === 200 && saved.body.data?.["bucket"] === TENANT_BUCKET && saved.body.data["hasCredentials"] === true, saved.body);
  check("the answer carries no credential", !saved.text.includes(SECRET) && !saved.text.includes(ACCESS), "secret or key in body");
  const tenantTest = await call("POST", "/storage/settings/test", token);
  check("POST /storage/settings/test — tenant bucket reachable", tenantTest.status === 200 && tenantTest.body.data?.["ok"] === true, tenantTest.body);

  // ---- usage pages past 1000 objects (the U-09 defect) -------------------
  const COUNT = 1005;
  await Promise.all(Array.from({ length: COUNT }, (_, i) => s3.send(new PutObjectCommand({
    Bucket: TENANT_BUCKET,
    Key: `t/${tenantId}/temp/usage-${String(i).padStart(4, "0")}.bin`,
    Body: Buffer.from("ab"),
  }))));
  const usage = await call("GET", "/storage/usage", token);
  check(`GET /storage/usage — ${String(COUNT)} objects across two S3 pages`, usage.status === 200 && usage.body.data?.["objects"] === COUNT && usage.body.data["bytes"] === COUNT * 2 && usage.body.data["provider"] === "s3", usage.body);

  // ---- the signed-object route reads the TENANT's bucket ----------------
  const key = `t/${tenantId}/certificates/u09-app-path.pdf`;
  const body = Buffer.from("%PDF-1.7 U-09 app path\n");
  await s3.send(new PutObjectCommand({ Bucket: TENANT_BUCKET, Key: key, Body: body, ContentType: "application/pdf" }));
  const got = await fetch(objectUrl(key, sign(key, 120)));
  const gotBody = Buffer.from(await got.arrayBuffer());
  check("GET /storage/object — 200, bytes from the tenant's S3 bucket", got.status === 200 && gotBody.equals(body), { status: got.status, body: gotBody.toString() });
  const ranged = await fetch(objectUrl(key, sign(key, 120)), { headers: { range: "bytes=0-3" } });
  check("GET /storage/object — Range answers 206", ranged.status === 206 && (await ranged.text()) === "%PDF", ranged.status);
  const forged = await fetch(objectUrl(key, `${String(Math.floor(Date.now() / 1000) + 60)}.${"0".repeat(64)}`));
  check("GET /storage/object — forged token 403", forged.status === 403, forged.status);

  // Tenant B (no override → the platform bucket): A's token does not open B's
  // key, and B's key resolves B's storage, not A's bucket.
  const tenantB = "b0900000-0000-4000-8000-0000000000b2";
  const keyB = `t/${tenantB}/certificates/u09-app-path.pdf`;
  const crossed = await fetch(objectUrl(keyB, sign(key, 120)));
  check("GET /storage/object — A's token on B's key 403", crossed.status === 403, crossed.status);
  const bMissing = await fetch(objectUrl(keyB, sign(keyB, 120)));
  check("GET /storage/object — B's key resolves B's storage (A's bucket not consulted: 404/410)", bMissing.status === 404 || bMissing.status === 410, bMissing.status);
  await s3.send(new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: keyB, Body: Buffer.from("platform B") }));
  const bFound = await fetch(objectUrl(keyB, sign(keyB, 120)));
  check("GET /storage/object — B's object served from the platform bucket", bFound.status === 200 && (await bFound.text()) === "platform B", bFound.status);

  // ---- an uploaded attachment goes straight into the TENANT's bucket ----
  // P8-01 (ADR-086 Amendment 1): the request path is cut over — the upload is
  // put into the tenant's storage after its scan, and served and deleted from
  // there. (Before P8-01 it went to the legacy disk path, and this block ran
  // the migration CLI to copy it; the CLI's legacy-file cases are in
  // scripts/storage/p801-app-path-check.ts.)
  const form = new FormData();
  const upload = Buffer.from(`U-09 attachment ${crypto.randomUUID()}\n`);
  form.append("file", new Blob([upload], { type: "text/plain" }), "u09-evidence.txt");
  const up = await fetch(`${API}/attachments`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  const upJson = (await up.json()) as Envelope;
  const attachmentId = String(upJson.data?.["id"] ?? "");
  const storedKey = `t/${tenantId}/attachments/${String(upJson.data?.["fileName"] ?? "")}`;
  check("POST /attachments — uploaded", up.status === 201 || up.status === 200, upJson);
  const head = await s3.send(new HeadObjectCommand({ Bucket: TENANT_BUCKET, Key: storedKey }));
  const copied = await s3.send(new GetObjectCommand({ Bucket: TENANT_BUCKET, Key: storedKey }));
  const copiedBytes = Buffer.from(await (copied.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  check("the upload is in the TENANT's bucket, byte-identical (P8-01)", head.ContentLength === upload.length && sha256(copiedBytes) === sha256(upload), { key: storedKey });
  const backendDir = need("BACKEND_DIR");
  const rerun = spawnSync(process.execPath, ["-r", "dotenv/config", "--import", "tsx", "src/scripts/migrateStorage.ts", "--tenant", tenantId], { cwd: backendDir, env: process.env, encoding: "utf8" });
  check("npm run migrate:storage — nothing to copy for it (it already has its key)", rerun.status === 0 && !rerun.stdout.includes(attachmentId), rerun.stdout.split(/\r?\n/).slice(-4).join(" "));
  const dl = await fetch(`${API}/attachments/${attachmentId}/download`, { headers: { authorization: `Bearer ${token}` } });
  check("GET /attachments/:id/download — served from the tenant's bucket", dl.status === 200 && Buffer.from(await dl.arrayBuffer()).equals(upload), dl.status);
  const del = await call("DELETE", `/attachments/${attachmentId}`, token);
  let gone = false;
  try { await s3.send(new HeadObjectCommand({ Bucket: TENANT_BUCKET, Key: storedKey })); } catch { gone = true; }
  check("DELETE /attachments/:id — 200, and the object is gone from the tenant's bucket", del.status === 200 && gone, del.body);

  // ---- back to the platform default --------------------------------------
  const cleared = await call("DELETE", "/storage/settings", token);
  check("DELETE /storage/settings — back to the platform default", cleared.status === 200 && cleared.body.data?.["usingPlatformDefault"] === true, cleared.body);
  const after = await call("GET", "/storage/usage", token);
  check("GET /storage/usage — now reads the platform bucket", after.status === 200 && after.body.data?.["objects"] !== COUNT, after.body);

  console.log(`\n${String(passed)} checks passed (tenant ${tenantId}, bucket ${TENANT_BUCKET})`);
};

main().catch((err: unknown) => {
  console.error("CRASH", err);
  process.exit(1);
});
