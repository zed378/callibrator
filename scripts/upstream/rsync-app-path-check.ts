/**
 * The rsync image import against a RUNNING backend (its image, with rsync/ssh/sshpass) and a
 * throwaway SSH server holding SYNTHETIC photos. Run by scripts/upstream/rsync-live-check.sh,
 * which starts every container and removes them by name; never pointed at a real server.
 *
 * Environment (all required):
 *   API                  backend base, e.g. http://127.0.0.1:5913/api/v1
 *   ADMIN_EMAIL          the seeded super admin (sys@mail.com)
 *   BOOTSTRAP_PASSWORD_FILE, ADMIN_NEW_PASSWORD, MFA_STATE_FILE   first sign-in (as the U-09 check)
 *   MAILPIT              Mailpit's API base, e.g. http://127.0.0.1:5914
 *   SSH_HOST             the source as the backend names it (test-ssh, allow-listed)
 *   SSH_PORT, SSH_USER, SSH_PASSWORD, SSH_KEY_FILE
 *   HOST_FINGERPRINT     the server's ed25519 fingerprint, read OUT OF BAND (ssh-keygen -lf on the
 *                        server) — what an operator compares before confirming
 *   EXPECTED             the fixtures' expected counts (JSON, rsync-live-fixtures.ts)
 *   STATE_FILE           where this check writes the ids the shell script inspects afterwards
 *
 * Prints one line per check and exits 1 on the first failure.
 */
import crypto from "crypto";
import fs from "fs";

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const API = need("API");
const MAILPIT = need("MAILPIT");
const SSH_PASSWORD = need("SSH_PASSWORD");
const SSH_KEY = fs.readFileSync(need("SSH_KEY_FILE"), "utf8");
const FINGERPRINT = need("HOST_FINGERPRINT");
const EXPECTED = JSON.parse(need("EXPECTED")) as {
  filesCopied: number;
  ingested: number;
  quarantined: number;
  quarantinedByReason: Record<string, number>;
  duplicateContent: number;
  metadataStripped: number;
  estimate: { front: number; serial: number };
};

let passed = 0;
const check = (name: string, ok: boolean, detail: unknown = ""): void => {
  if (!ok) {
    console.error(`FAIL  ${name}  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`ok    ${name}`);
};

interface Envelope {
  success?: boolean;
  status?: number;
  message?: string;
  data?: Record<string, unknown> & Record<string, unknown>[];
  token?: string;
}

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
  try {
    parsed = JSON.parse(text) as Envelope;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed, text };
};

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits). */
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
  const value =
    (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(value % 1000000).padStart(6, "0");
};

const signIn = async (): Promise<string> => {
  const email = need("ADMIN_EMAIL");
  const file = need("BOOTSTRAP_PASSWORD_FILE");
  const oneTime = fs.readFileSync(file, "utf8").trim();
  const first = await call("POST", "/auth/login", null, { email, password: oneTime });
  const changed = await call("POST", "/auth/first-sign-in/password", null, { token: first.body.token, newPassword: need("ADMIN_NEW_PASSWORD") });
  check("first sign-in password set", changed.status === 200, changed.body.message);
  const password = need("ADMIN_NEW_PASSWORD");
  let login = await call("POST", "/auth/login", null, { email, password });
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
  check("signed in as the super admin", login.status === 200 && typeof login.body.token === "string", login.body.message);
  return login.body.token as string;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const BASE = "/admin/upstream-file-imports";

const main = async (): Promise<void> => {
  const token = await signIn();
  const source = {
    host: need("SSH_HOST"),
    port: Number(need("SSH_PORT")),
    username: need("SSH_USER"),
    authMethod: "password",
    password: SSH_PASSWORD,
    remotePath: "/srv/upstream/public/uploads",
    fileClasses: ["front", "serial"],
    syntheticSource: true,
  };
  const noSecret = (text: string, what: string): void => {
    check(`${what} carries neither the password nor the key`, !text.includes(SSH_PASSWORD) && !text.includes(SSH_KEY.split("\n")[1] ?? "KEY"), "secret in body");
  };

  // ---- configuration and refusals -------------------------------------------------------
  const cfg = await call("GET", `${BASE}/config`, token);
  check("GET /config — the DPIA gate is closed (UPSTREAM_REAL_DATA_ALLOWED=false)", cfg.status === 200 && cfg.body.data?.["realDataAllowed"] === false, cfg.body);
  const real = await call("POST", `${BASE}/check-connection`, token, { ...source, syntheticSource: false });
  check("a REAL source is refused while the gate is closed (403)", real.status === 403, real.body);
  const injected = await call("POST", `${BASE}/check-connection`, token, { ...source, host: "test-ssh;id" });
  check("an injected host is a 400", injected.status === 400, injected.body);
  const traversal = await call("POST", `${BASE}/check-connection`, token, { ...source, remotePath: "/srv/../etc" });
  check("a traversing path is a 400", traversal.status === 400, traversal.body);
  const notAllowListed = await call("POST", `${BASE}/check-connection`, token, { ...source, host: "127.0.0.1" });
  check("a synthetic source on a host NOT allow-listed is refused (403)", notAllowListed.status === 403, notAllowListed.body);

  // ---- check connection: keys → confirm → estimate -------------------------------------
  const keys = await call("POST", `${BASE}/check-connection`, token, source);
  const hostKeys = (keys.body.data?.["hostKeys"] ?? []) as { type: string; fingerprint: string }[];
  check("check — the host keys, no login (host_key_unconfirmed)", keys.status === 200 && keys.body.data?.["status"] === "host_key_unconfirmed", keys.body);
  check("check — the ed25519 fingerprint equals the one read on the server out of band", hostKeys.some((k) => k.type === "ssh-ed25519" && k.fingerprint === FINGERPRINT), hostKeys);
  noSecret(keys.text, "the check's answer");

  const wrongKey = await call("POST", `${BASE}/check-connection`, token, { ...source, confirmedFingerprint: `SHA256:${"A".repeat(43)}` });
  check("check — a fingerprint the server does not present → host_key_mismatch", wrongKey.body.data?.["status"] === "host_key_mismatch", wrongKey.body);

  const confirmed = await call("POST", `${BASE}/check-connection`, token, { ...source, confirmedFingerprint: FINGERPRINT });
  const classes = confirmed.body.data?.["classes"] as Record<string, { status: string; files: number }> | undefined;
  check("check — logged in (password, pinned key) and listed both classes", confirmed.body.data?.["status"] === "ok", confirmed.body);
  check(
    "check — the estimate counts the synthetic files per class",
    classes?.["front"]?.files === EXPECTED.estimate.front && classes["serial"]?.files === EXPECTED.estimate.serial,
    classes,
  );

  const badPassword = await call("POST", `${BASE}/check-connection`, token, { ...source, password: "wrong-password", confirmedFingerprint: FINGERPRINT });
  check("check — a wrong password → auth_failed", badPassword.body.data?.["status"] === "auth_failed", badPassword.body);
  const missing = await call("POST", `${BASE}/check-connection`, token, { ...source, remotePath: "/srv/nowhere", confirmedFingerprint: FINGERPRINT });
  check("check — a missing class folder → path_not_found", missing.body.data?.["status"] === "path_not_found", missing.body);
  const keyAuth = await call("POST", `${BASE}/check-connection`, token, {
    ...source,
    authMethod: "key",
    password: undefined,
    privateKey: SSH_KEY,
    confirmedFingerprint: FINGERPRINT,
  });
  check("check — key authentication works too", keyAuth.body.data?.["status"] === "ok", keyAuth.body);

  // ---- the target tenant ----------------------------------------------------------------
  const tenants = await call("GET", "/tenants/all?page=1&limit=10", token);
  const tenant = (tenants.body.data as unknown as { id: string; status: string }[] | undefined)?.find((t) => t.status === "active");
  check("an active target tenant exists", Boolean(tenant), tenants.body);
  const targetTenantId = tenant?.id as string;

  // ---- import 1: password auth, completes ---------------------------------------------
  const started = await call("POST", BASE, token, { ...source, confirmedFingerprint: FINGERPRINT, targetTenantId });
  check("start — queued (201), the credential stored only encrypted", started.status === 201 && started.body.data?.["credentialStored"] === true, started.body);
  noSecret(started.text, "the start's answer");
  const firstId = String(started.body.data?.["id"]);
  const waitFor = async (id: string, statuses: string[], timeoutMs = 180_000): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const got = await call("GET", `${BASE}/${id}`, token);
      const status = String(got.body.data?.["status"]);
      if (statuses.includes(status) || Date.now() > deadline) {
        return got.body.data as Record<string, unknown>;
      }
      await sleep(1000);
    }
  };
  const first = await waitFor(firstId, ["completed", "failed", "cancelled"]);
  const summary = first["summary"] as Record<string, unknown> | null;
  check("import 1 — completed", first["status"] === "completed", first);
  check("import 1 — the credential was erased with the terminal status", first["credentialStored"] === false && typeof first["secretErasedAt"] === "string", first);
  check(
    "import 1 — counts: copied, ingested, quarantined, stripped, duplicates",
    summary?.["filesCopied"] === EXPECTED.filesCopied &&
      summary["ingested"] === EXPECTED.ingested &&
      summary["quarantined"] === EXPECTED.quarantined &&
      summary["metadataStripped"] === EXPECTED.metadataStripped &&
      summary["duplicateContent"] === EXPECTED.duplicateContent,
    summary,
  );
  const sorted = (o: unknown): string => JSON.stringify(Object.entries((o ?? {}) as Record<string, number>).sort(([x], [y]) => x.localeCompare(y)));
  check("import 1 — quarantined by reason (script, text, HEIC, truncated)", sorted(summary?.["quarantinedByReason"]) === sorted(EXPECTED.quarantinedByReason), summary);

  // ---- the notification: in-app and e-mail, counts only --------------------------------
  const notes = await call("GET", "/notifications?page=1&limit=5", token);
  const note = (notes.body.data as unknown as { title: string; message: string }[] | undefined)?.find((n) => n.title.includes("Image import completed"));
  check("in-app notification to the requester", Boolean(note), notes.body);
  check("the notification carries counts, no file name", Boolean(note?.message.includes(`Ingested: ${String(EXPECTED.ingested)}`)) && !/d-0001|upload\.sh|foto_|srv\//.test(note?.message ?? ""), note);
  let mail: { Subject?: string; To?: { Address?: string }[] } | undefined;
  for (let i = 0; i < 30 && !mail; i += 1) {
    const res = await fetch(`${MAILPIT}/api/v1/messages`);
    const list = (await res.json()) as { messages?: { Subject?: string; To?: { Address?: string }[] }[] };
    mail = list.messages?.find((m) => (m.Subject ?? "").includes("Image import completed"));
    if (!mail) {
      await sleep(1000);
    }
  }
  check("e-mail notification delivered (Mailpit)", Boolean(mail) && mail?.To?.[0]?.Address === need("ADMIN_EMAIL"), mail);

  // ---- import 2: key auth, everything already present -----------------------------------
  const second = await call("POST", BASE, token, {
    ...source,
    authMethod: "key",
    password: undefined,
    privateKey: SSH_KEY,
    confirmedFingerprint: FINGERPRINT,
    targetTenantId,
  });
  const secondDone = await waitFor(String(second.body.data?.["id"]), ["completed", "failed", "cancelled"]);
  check(
    "import 2 (key auth) — completed; every image skipped as already present",
    secondDone["status"] === "completed" && (secondDone["summary"] as Record<string, unknown>)["skippedPresent"] === EXPECTED.ingested,
    secondDone,
  );

  // ---- import 3: bandwidth-limited, cancelled mid-transfer ------------------------------
  const third = await call("POST", BASE, token, { ...source, confirmedFingerprint: FINGERPRINT, targetTenantId, bandwidthLimitKbps: 64 });
  const thirdId = String(third.body.data?.["id"]);
  const running = await waitFor(thirdId, ["transferring"], 60_000);
  check("import 3 — transferring (64 KiB/s)", running["status"] === "transferring", running);
  fs.writeFileSync(need("STATE_FILE"), JSON.stringify({ firstId, thirdId, phase: "transferring" }));
  // The shell script reads every process's argv while the transfer runs (no password in argv).
  await sleep(Number(process.env["ARGV_WINDOW_MS"] ?? "6000"));
  const cancel = await call("POST", `${BASE}/${thirdId}/cancel`, token);
  check("import 3 — cancel requested", cancel.status === 200 && cancel.body.data?.["cancelRequested"] === true, cancel.body);
  const thirdDone = await waitFor(thirdId, ["cancelled", "completed", "failed"], 60_000);
  check("import 3 — cancelled within seconds; credential erased", thirdDone["status"] === "cancelled" && thirdDone["credentialStored"] === false, thirdDone);
  const again = await call("POST", `${BASE}/${thirdId}/cancel`, token);
  check("cancelling an ended import is a 409", again.status === 409, again.body);

  const list = await call("GET", `${BASE}?page=1&limit=10`, token);
  check("GET / — rows in data, meta top-level", Array.isArray(list.body.data) && (list.body as { meta?: { total?: number } }).meta?.total === 3, list.body);
  noSecret(list.text, "the list");
  fs.writeFileSync(need("STATE_FILE"), JSON.stringify({ firstId, thirdId, phase: "done" }));
  console.log(`\n${String(passed)} checks passed`);
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
