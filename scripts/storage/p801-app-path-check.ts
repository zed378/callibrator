/**
 * P8-01 (ADR-086 Amendment 1) — every file the application stores or serves,
 * through a RUNNING backend whose platform storage is a real S3-compatible
 * server, with two tenants. Run by scripts/storage/p801-live-check.sh (which
 * starts SeaweedFS, PostgreSQL 18, Redis and the backend with
 * STORAGE_DRIVER=s3 and SEED_DEMO=true).
 *
 * Every "it is in storage" check reads the BUCKET directly with its own S3
 * client — never the application's answer about itself. Every "another tenant"
 * check is a principal of the other tenant asking for the first one's id.
 *
 * Environment:
 *   API, ADMIN_EMAIL, BOOTSTRAP_PASSWORD_FILE / ADMIN_PASSWORD, ADMIN_NEW_PASSWORD,
 *   MFA_STATE_FILE                 as s3-app-path-check.ts
 *   S3_ADMIN_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION (us-east-1)
 *   PLATFORM_BUCKET                the backend's STORAGE_S3_BUCKET
 *   BACKEND_DIR                    backend/ (legacy files are laid down there,
 *                                  and the migration CLI runs there)
 *   PSQL                           a command prefix that runs psql against the
 *                                  backend's database, e.g. "docker exec -i <pg> psql -U u -d db -At"
 */
import { spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import {
  S3Client,
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) {throw new Error(`${name} is required`);}
  return value;
};

const API = need("API");
const ORIGIN = new URL(API).origin;
const BUCKET = need("PLATFORM_BUCKET");
const BACKEND_DIR = need("BACKEND_DIR");
const s3 = new S3Client({
  region: process.env["S3_REGION"] ?? "us-east-1",
  endpoint: need("S3_ADMIN_ENDPOINT"),
  forcePathStyle: true,
  credentials: { accessKeyId: need("S3_ACCESS_KEY"), secretAccessKey: need("S3_SECRET_KEY") },
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

interface Envelope { success?: boolean; status?: number; message?: string; data?: Record<string, unknown> & { id?: string }; token?: string }
interface Session { token: string; user: Record<string, unknown> }

const call = async (method: string, p: string, token: string | null, body?: unknown): Promise<{ status: number; body: Envelope; text: string }> => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: Envelope = {};
  try { parsed = JSON.parse(text) as Envelope; } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
};
const raw = async (url: string, token: string | null, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; body: Buffer }> => {
  const res = await fetch(url, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
};
const multipart = async (p: string, token: string, field: string, name: string, type: string, bytes: Buffer, extra: Record<string, string> = {}, method = "POST"): Promise<{ status: number; body: Envelope }> => {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) {form.append(k, v);}
  form.append(field, new Blob([new Uint8Array(bytes)], { type }), name);
  const res = await fetch(`${API}${p}`, { method, headers: { authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  let parsed: Envelope = {};
  try { parsed = JSON.parse(text) as Envelope; } catch { parsed = { message: text.slice(0, 300) }; }
  return { status: res.status, body: parsed };
};

/** A GET with If-None-Match over node:http (see the call site). */
const conditional = (url: string, token: string, etag: string): Promise<{ status: number }> =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method: "GET", headers: { authorization: `Bearer ${token}`, "if-none-match": etag } }, (res) => {
      res.resume();
      res.on("end", () => { resolve({ status: res.statusCode ?? 0 }); });
    });
    req.on("error", reject);
    req.end();
  });

/** The bucket's own answer: the object's bytes, or null when it is not there. */
const inBucket = async (key: string): Promise<Buffer | null> => {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    return null;
  }
  const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await (got.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
};
const listBucket = async (prefix: string): Promise<string[]> => {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    out.push(...(page.Contents ?? []).map((o) => o.Key as string));
    token = page.NextContinuationToken;
  } while (token);
  return out;
};

const totpAt = (secret: string, step: number): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) {bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");}
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", bytes).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0xf;
  const value = (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(value % 1000000).padStart(6, "0");
};
const lastStep = new Map<string, number>();
const code = async (who: string, secret: string): Promise<string> => {
  let step = Math.floor(Date.now() / 30000);
  // A code is spent once: wait for the next window rather than reuse one.
  while (step <= (lastStep.get(who) ?? -1)) {
    await new Promise((r) => setTimeout(r, 1000));
    step = Math.floor(Date.now() / 30000);
  }
  lastStep.set(who, step);
  return totpAt(secret, step);
};
const secrets: Record<string, string> = {};

/** Sign in, enrolling MFA when the account must hold it. */
const signIn = async (email: string, password: string): Promise<Session> => {
  let login = await call("POST", "/auth/login", null, { email, password });
  if (login.body.data?.["mustChangePassword"] && login.body.token) {
    throw new Error(`${email} must change its password first`);
  }
  if (login.body.data?.["mfaEnrolmentRequired"] && login.body.token) {
    const setup = await call("POST", "/auth/mfa/setup", login.body.token, {});
    const secret = String(setup.body.data?.["secret"] ?? "");
    secrets[email] = secret;
    const verified = await call("POST", "/auth/mfa/verify", login.body.token, { code: await code(email, secret) });
    if (verified.status !== 200) {throw new Error(`MFA verify for ${email}: ${verified.text}`);}
    login = await call("POST", "/auth/login", null, { email, password });
  }
  if (login.body.data?.["mfaRequired"] && login.body.token) {
    const secret = secrets[email] ?? fs.readFileSync(need("MFA_STATE_FILE"), "utf8");
    login = await call("POST", "/auth/mfa/login", null, { token: login.body.token, code: await code(email, secret) });
  }
  if (login.status !== 200 || typeof login.body.token !== "string") {throw new Error(`sign-in of ${email}: ${login.status} ${login.text}`);}
  return { token: login.body.token, user: login.body.data ?? {} };
};

const operatorSignIn = async (): Promise<Session> => {
  const email = need("ADMIN_EMAIL");
  const file = process.env["BOOTSTRAP_PASSWORD_FILE"];
  if (file && fs.existsSync(file)) {
    const first = await call("POST", "/auth/login", null, { email, password: fs.readFileSync(file, "utf8").trim() });
    const changed = await call("POST", "/auth/first-sign-in/password", null, { token: first.body.token, newPassword: need("ADMIN_NEW_PASSWORD") });
    check("operator: first sign-in password set", changed.status === 200, changed.body.message);
  }
  const password = process.env["ADMIN_PASSWORD"] ?? need("ADMIN_NEW_PASSWORD");
  let login = await call("POST", "/auth/login", null, { email, password });
  if (login.body.data?.["mfaEnrolmentRequired"] && login.body.token) {
    const setup = await call("POST", "/auth/mfa/setup", login.body.token, {});
    const secret = String(setup.body.data?.["secret"] ?? "");
    fs.writeFileSync(need("MFA_STATE_FILE"), secret, { mode: 0o600 });
    secrets[email] = secret;
    await call("POST", "/auth/mfa/verify", login.body.token, { code: await code(email, secret) });
  }
  return signIn(email, password);
};

/** A tenant administrator, created by the operator, its one-time password replaced. */
const tenantAdmin = async (operator: Session, tenantId: string, roleId: string, tag: string): Promise<Session> => {
  const stamp = crypto.randomBytes(3).toString("hex");
  const email = `p801.${tag}.${stamp}@example.com`;
  const temporary = `Temp-${stamp}-Aa1!`;
  const chosen = `P801-${stamp}-Bb2!x`;
  const created = await call("POST", "/users/create", operator.token, {
    tenantId, username: `p801${tag}${stamp}`.slice(0, 20), firstName: "P801", lastName: `Tenant ${tag.toUpperCase()}`, email, password: temporary, roleId, status: "ACTIVE",
  });
  if (created.status >= 300) {throw new Error(`creating ${email}: ${created.status} ${created.text}`);}
  const first = await call("POST", "/auth/login", null, { email, password: temporary });
  const changed = await call("POST", "/auth/first-sign-in/password", null, { token: first.body.token, newPassword: chosen });
  if (changed.status !== 200) {throw new Error(`first sign-in of ${email}: ${changed.status} ${changed.text}`);}
  return signIn(email, chosen);
};

const psql = (sql: string): string => {
  const parts = need("PSQL").split(" ");
  const out = spawnSync(parts[0] as string, [...parts.slice(1), "-c", sql], { encoding: "utf8" });
  if (out.status !== 0) {throw new Error(`psql: ${out.stderr}`);}
  return out.stdout.trim();
};

const main = async (): Promise<void> => {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (err) {
    if (!/BucketAlready/.test((err as Error).name)) {throw err;}
  }
  const operator = await operatorSignIn();
  check("operator signed in", Boolean(operator.token));
  const seeded = await call("GET", "/migration/seed-demo", operator.token);
  check("demo tenants seeded", seeded.status === 200 || seeded.status === 409, seeded.text.slice(0, 200));

  const tenants = (await call("GET", "/tenants/all?limit=100", operator.token)).body.data as unknown as { id: string; subdomain: string }[];
  const A = tenants.find((t) => t.subdomain === "demo-alpha")?.id ?? "";
  const B = tenants.find((t) => t.subdomain === "demo-beta")?.id ?? "";
  check("two tenants: demo-alpha and demo-beta", /^[0-9a-f-]{36}$/.test(A) && /^[0-9a-f-]{36}$/.test(B), { A, B });
  const roles = (await call("GET", "/roles?limit=100", operator.token)).body.data as unknown as { id: string; name: string }[];
  const adminRole = roles.find((r) => r.name === "HEALTHCARE ADMIN")?.id ?? "";
  const adminA = await tenantAdmin(operator, A, adminRole, "a");
  const adminB = await tenantAdmin(operator, B, adminRole, "b");
  check("an administrator in each tenant", Boolean(adminA.token && adminB.token));
  const userA = String(adminA.user["id"] ?? adminA.user["userId"] ?? "");

  // ---- attachments ---------------------------------------------------------
  const evidence = Buffer.from(`%PDF-1.7 P8-01 evidence ${crypto.randomUUID()}\n`);
  const up = await multipart("/attachments", adminA.token, "file", "p801-evidence.pdf", "application/pdf", evidence);
  check("POST /attachments (tenant A) — 201", up.status === 201, up.body);
  const att = up.body.data as Record<string, string>;
  const attKey = `t/${A}/attachments/${att["fileName"] ?? ""}`;
  check("the upload is in the BUCKET under tenant A's key, byte-identical", (await inBucket(attKey))?.equals(evidence) === true, attKey);
  check("…and nowhere on the backend's disk", !fs.existsSync(path.join(BACKEND_DIR, "uploads", "attachments", att["fileName"] ?? "x")) && fs.readdirSync(path.join(BACKEND_DIR, "uploads", ".quarantine")).length === 0);
  const dl = await raw(`${API}/attachments/${att["id"] ?? ""}/download`, adminA.token);
  check("GET /attachments/:id/download — 200 from S3, bytes equal, inline PDF", dl.status === 200 && dl.body.equals(evidence) && /^inline; filename="p801-evidence.pdf"/.test(dl.headers.get("content-disposition") ?? ""), { status: dl.status, cd: dl.headers.get("content-disposition") });
  const ranged = await raw(`${API}/attachments/${att["id"] ?? ""}/download`, adminA.token, { range: "bytes=0-3" });
  check("…Range: bytes=0-3 → 206 %PDF", ranged.status === 206 && ranged.body.toString() === "%PDF" && ranged.headers.get("content-range") === `bytes 0-3/${String(evidence.length)}`, ranged.status);
  const etag = dl.headers.get("etag") ?? "";
  // node:http, not fetch: undici adds `cache-control: no-cache` to a conditional request, which makes every answer stale.
  const cond = await conditional(`${API}/attachments/${att["id"] ?? ""}/download`, adminA.token, etag);
  check("…If-None-Match its ETag → 304", etag !== "" && cond.status === 304, { etag, status: cond.status });
  const crossDl = await raw(`${API}/attachments/${att["id"] ?? ""}/download`, adminB.token);
  check("tenant B: GET A's attachment download → 404", crossDl.status === 404 && !crossDl.body.includes(evidence), crossDl.status);
  const crossSigned = await call("POST", `/attachments/${att["id"] ?? ""}/signed-url`, adminB.token, {});
  check("tenant B: POST A's attachment signed-url → 404", crossSigned.status === 404, crossSigned.status);
  const signedUrl = await call("POST", `/attachments/${att["id"] ?? ""}/signed-url`, adminA.token, {});
  const link = new URL(String(signedUrl.body.data?.["url"] ?? ""));
  const viaLink = await raw(`${API}${link.pathname.replace("/api/v1", "")}${link.search}`, null);
  check("a signed link (no session) serves the S3 object", viaLink.status === 200 && viaLink.body.equals(evidence), viaLink.status);
  const crossDel = await call("DELETE", `/attachments/${att["id"] ?? ""}`, adminB.token);
  check("tenant B: DELETE A's attachment → 404, object kept", crossDel.status === 404 && (await inBucket(attKey)) !== null, crossDel.status);
  const del = await call("DELETE", `/attachments/${att["id"] ?? ""}`, adminA.token);
  check("DELETE /attachments/:id (tenant A) — 200, and the object is GONE from the bucket", del.status === 200 && (await inBucket(attKey)) === null, del.status);
  check("…the signed link now 404s", (await raw(`${API}${link.pathname.replace("/api/v1", "")}${link.search}`, null)).status === 404);

  // ---- avatar (public class) ------------------------------------------------
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
  const avatar = await multipart(`/users/${userA}/avatar`, adminA.token, "file", "me.png", "image/png", png);
  const avatarFile = String((avatar.body.data as Record<string, unknown> | undefined)?.["avatar"] ?? "");
  check("POST /users/:id/avatar — 200", avatar.status === 200 && avatarFile !== "", avatar.body);
  check("the avatar is in the BUCKET at global/avatars/<file>", (await inBucket(`global/avatars/${avatarFile}`))?.equals(png) === true, avatarFile);
  const served = await raw(`${ORIGIN}/uploads/public/profile/${avatarFile}`, null);
  check("GET /uploads/public/profile/<file> — served from S3 as image/png, nosniff, sandboxed", served.status === 200 && served.body.equals(png) && served.headers.get("content-type") === "image/png" && served.headers.get("x-content-type-options") === "nosniff" && (served.headers.get("content-security-policy") ?? "").includes("sandbox"), served.status);
  const removed = await call("DELETE", `/users/${userA}/avatar`, adminA.token);
  check("DELETE /users/:id/avatar — the object is removed from the bucket", removed.status === 200 && (await inBucket(`global/avatars/${avatarFile}`)) === null, removed.status);

  // ---- tenant logo (public class) ------------------------------------------
  const logo = await multipart(`/tenants/${A}/logo`, adminA.token, "file", "logo.png", "image/png", png);
  const logoFile = String((logo.body.data as Record<string, unknown> | undefined)?.["logo"] ?? "");
  check("POST /tenants/:id/logo — 200, in the BUCKET at global/branding/<file>", logo.status === 200 && (await inBucket(`global/branding/${logoFile}`))?.equals(png) === true, logo.body);
  check("GET /uploads/public/tenant/<file> — served from S3", (await raw(`${ORIGIN}/uploads/public/tenant/${logoFile}`, null)).status === 200);
  const crossLogo = await multipart(`/tenants/${A}/logo`, adminB.token, "file", "logo.png", "image/png", png);
  check("tenant B: POST A's logo — refused (not 2xx)", crossLogo.status >= 400, crossLogo.status);

  // ---- tenant backup -------------------------------------------------------
  const backup = await call("POST", `/tenants/${A}/backups`, operator.token, { name: "p801", backupType: "FULL" });
  const backupRow = backup.body.data as Record<string, unknown> | undefined;
  const backupKey = String(backupRow?.["filePath"] ?? "");
  check("POST /tenants/:id/backups — 201, filePath is tenant A's storage key", backup.status === 201 && backupKey.startsWith(`t/${A}/backups/`), backup.body);
  const backupBytes = await inBucket(backupKey);
  check("the archive is in the BUCKET (a ZIP)", backupBytes?.subarray(0, 2).toString() === "PK", backupKey);
  const bdl = await raw(`${API}/tenants/${A}/backups/${String(backupRow?.["id"])}/download`, operator.token);
  check("GET …/backups/:id/download — 200 from S3, bytes equal, a saved-as attachment", bdl.status === 200 && backupBytes !== null && bdl.body.equals(backupBytes) && /^attachment; filename=/.test(bdl.headers.get("content-disposition") ?? ""), bdl.status);
  const bcross = await raw(`${API}/tenants/${A}/backups/${String(backupRow?.["id"])}/download`, adminB.token);
  check("tenant B: download A's backup — refused, no bytes", bcross.status >= 400 && backupBytes !== null && !bcross.body.includes(backupBytes.subarray(0, 64)), bcross.status);
  const bdel = await call("DELETE", `/tenants/${A}/backups/${String(backupRow?.["id"])}`, operator.token);
  check("DELETE …/backups/:id — the object is removed from the bucket", bdel.status === 200 && (await inBucket(backupKey)) === null, bdel.status);

  // ---- GDPR export ---------------------------------------------------------
  const exp = await call("POST", "/gdpr/export", adminA.token, {});
  const exportId = String(exp.body.data?.["exportId"] ?? "");
  check("POST /gdpr/export — 200; archive and manifest in tenant A's storage", exp.status === 200 && (await inBucket(`t/${A}/exports/${exportId}.zip`)) !== null && (await inBucket(`t/${A}/exports/${exportId}.json`)) !== null, exp.body);
  const edl = await raw(`${API}/gdpr/exports/${exportId}/download`, adminA.token);
  check("GET /gdpr/exports/:id/download — 200 from S3, no-store attachment", edl.status === 200 && edl.body.subarray(0, 2).toString() === "PK" && edl.headers.get("cache-control") === "no-store", edl.status);
  check("tenant B: the same export id → 404", (await raw(`${API}/gdpr/exports/${exportId}/download`, adminB.token)).status === 404);

  // ---- legacy files → migration tool → served from storage ------------------
  // A demo certificate — of tenant A when it has one, else of whichever tenant
  // does (an administrator is made there; tenant B, or A, is the other tenant).
  const [certRow = "", certTenant = ""] = psql(
    `SELECT id || '|' || tenant_id FROM certificates WHERE deleted_at IS NULL ORDER BY (tenant_id = '${A}') DESC, id LIMIT 1`,
  ).split("|");
  const certOwner = certTenant === A ? adminA : certTenant === B ? adminB : await tenantAdmin(operator, certTenant, adminRole, "c");
  const certOther = certTenant === B ? adminA : adminB;
  const certFile = `p801-${crypto.randomBytes(4).toString("hex")}.pdf`;
  const certPdf = Buffer.from(`%PDF-1.7 P8-01 legacy certificate ${crypto.randomUUID()}\n`);
  const legacyCert = path.join(BACKEND_DIR, "uploads", "certificates", certFile);
  fs.mkdirSync(path.dirname(legacyCert), { recursive: true });
  fs.writeFileSync(legacyCert, certPdf);
  const legacyAvatar = `p801-legacy-${crypto.randomBytes(4).toString("hex")}.png`;
  fs.mkdirSync(path.join(BACKEND_DIR, "uploads", "public", "profile"), { recursive: true });
  fs.writeFileSync(path.join(BACKEND_DIR, "uploads", "public", "profile", legacyAvatar), png);
  check("a legacy certificate PDF and avatar laid down on disk", /^[0-9a-f-]{36}$/.test(certRow) && /^[0-9a-f-]{36}$/.test(certTenant), { certRow, certTenant });
  psql(`UPDATE certificates SET file_path = 'certificates/${certFile}' WHERE id = '${certRow}'`);
  const beforeServed = await raw(`${API}/certificates/${certRow}/pdf`, certOwner.token);
  check("before migration: the certificate PDF is served from its legacy path", beforeServed.status === 200 && beforeServed.body.equals(certPdf), beforeServed.status);
  check("before migration: the legacy avatar is served from its legacy folder", (await raw(`${ORIGIN}/uploads/public/profile/${legacyAvatar}`, null)).status === 200);

  const run = (): ReturnType<typeof spawnSync> =>
    spawnSync(process.execPath, ["-r", "dotenv/config", "--import", "tsx", "src/scripts/migrateStorage.ts"], { cwd: BACKEND_DIR, env: process.env, encoding: "utf8" });
  const migrated = run();
  const out = `${String(migrated.stdout)}${String(migrated.stderr)}`;
  check("npm run migrate:storage — exit 0", migrated.status === 0, out.split(/\r?\n/).slice(-8).join(" | "));
  check("the certificate PDF is in the BUCKET at t/<its tenant>/certificates/<file>, byte-identical", (await inBucket(`t/${certTenant}/certificates/${certFile}`))?.equals(certPdf) === true);
  check("the avatar is in the BUCKET at global/avatars/<file>", (await inBucket(`global/avatars/${legacyAvatar}`))?.equals(png) === true);
  fs.rmSync(legacyCert);
  fs.rmSync(path.join(BACKEND_DIR, "uploads", "public", "profile", legacyAvatar));
  const afterServed = await raw(`${API}/certificates/${certRow}/pdf`, certOwner.token);
  check("legacy files REMOVED from disk: the PDF is now served from S3", afterServed.status === 200 && afterServed.body.equals(certPdf) && /^attachment; filename=/.test(afterServed.headers.get("content-disposition") ?? ""), afterServed.status);
  check("…and the avatar from S3", (await raw(`${ORIGIN}/uploads/public/profile/${legacyAvatar}`, null)).status === 200);
  check("another tenant: the certificate PDF → 404", (await raw(`${API}/certificates/${certRow}/pdf`, certOther.token)).status === 404);
  const rerun = run();
  check("a re-run copies nothing (resumable)", rerun.status === 0 && !/^\s*migrated\s/m.test(String(rerun.stdout)), String(rerun.stdout).split(/\r?\n/).slice(-6).join(" | "));

  // ---- counts, from the bucket itself ----------------------------------------
  const objectsA = await listBucket(`t/${A}/`);
  const objectsB = await listBucket(`t/${B}/`);
  const expectedA = [`t/${A}/exports/${exportId}.json`, `t/${A}/exports/${exportId}.zip`, ...(certTenant === A ? [`t/${A}/certificates/${certFile}`] : [])].sort();
  check("tenant A's prefix holds exactly what is live: the export (+ the migrated PDF if A's) — the attachment and backup were deleted", JSON.stringify(objectsA.sort()) === JSON.stringify(expectedA), objectsA);
  check("tenant B's prefix holds nothing of A's", objectsB.every((k) => k.startsWith(`t/${B}/`)) && !objectsB.some((k) => k.includes(A)), objectsB);
  psql(`UPDATE certificates SET file_path = NULL WHERE id = '${certRow}'`);

  console.log(`\n${String(passed)} checks passed (tenants ${A}, ${B}; bucket ${BUCKET})`);
};

main().catch((err: unknown) => {
  console.error("CRASH", err);
  process.exit(1);
});
