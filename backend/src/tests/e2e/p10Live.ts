/**
 * P10-13 — the helpers the Phase 10 live specs share (not a spec: jest's e2e
 * testMatch is `*.test.{js,ts}`).
 *
 * The P10 specs talk to the backend with their own typed `call` rather than
 * setup.js's helpers, for two reasons:
 *
 *  1. They need to choose the CLIENT ADDRESS. The backend trusts one proxy hop
 *     (index.js, TRUST_PROXY_HOPS = 1, A-16): `req.ip` is the rightmost
 *     X-Forwarded-For entry. Behind nginx that hop is nginx; here the spec
 *     talks to the backend directly, so the spec IS that hop, and a spec that
 *     sends `X-Forwarded-For: <address>` is a client at that address. Every
 *     scenario draws a fresh address from 198.18.0.0/15 (RFC 2544, benchmark
 *     space — never a real client), so the production budgets (ADR-100:
 *     5 access requests an hour, 60 minimal verdicts per 15 minutes, per
 *     address) are MEASURED, not dodged, and two runs back to back do not
 *     inherit each other's counters.
 *  2. The bodies are `unknown` and narrowed here, so the specs are strict
 *     TypeScript with no `any` (docs/ENGINEERING/04).
 *
 * The operator (the seeded super admin) still signs in through setup.js's
 * `httpPost("/auth/login")`, which completes the bootstrap one-time password
 * and MFA for it (P10-16, P6-07).
 *
 * MAIL. The invitation link and the reset code exist only in an email. The
 * stack under test sends mail to an SMTP sink with an HTTP API (Mailpit;
 * E2E_MAILPIT_URL, e.g. http://127.0.0.1:27132). Mail is MANDATORY for the e2e
 * runner (2026-10-10, owner rule "no test may be skipped"): the runner's
 * globalSetup (requireMailpit.ts) refuses to start without a reachable Mailpit,
 * and every mailed-secret test runs.
 */
import { randomBytes } from "crypto";
import { environment } from "../../config/env";
import { httpPost, extractToken, OPERATOR, OPERATOR_PASSWORD, API_BASE } from "./setup";

const penv = environment();

/** A response, with the body not yet trusted. */
interface Reply {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** What `call` can be told. */
interface CallOptions {
  body?: unknown;
  token?: string | null;
  /** The client address the backend will see (one trusted hop, see the header). */
  from?: string;
  headers?: Record<string, string>;
}

/** The API base (`<BASE_URL>/api/v1`), as setup.js computed it. */
export const apiBase = (): string => API_BASE;

/** One HTTP call to the backend. Never throws on a status. */
export const call = async (method: string, path: string, options: CallOptions = {}): Promise<Reply> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Callibrator-E2E-P10/1.0",
    ...(options.headers ?? {}),
  };
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }
  if (options.from) {
    headers["X-Forwarded-For"] = options.from;
  }
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(20000) };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  const res = await fetch(`${apiBase()}${path}`, init);
  const type = res.headers.get("content-type") ?? "";
  const body: unknown = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, headers: Object.fromEntries(res.headers) };
};

/**
 * What an error answer SAYS — status, success, message, data — without what
 * a non-production stack adds for developers (`stack`, `error`). Neutrality
 * is compared on this, never on stack text (whose line numbers move).
 */
export const envelope = (reply: Reply): Record<string, unknown> => {
  const body = obj(reply.body);
  return { status: reply.status, success: body["success"], message: body["message"], data: body["data"] ?? null };
};

let modeProbe: Promise<"production" | "non-production"> | null = null;

/**
 * Whether the stack runs with PRODUCTION configuration. The production
 * budgets (ADR-100) and the absent /auth/register (P10-12) exist only there;
 * outside production every budget is multiplied by
 * RATE_LIMIT_NON_PRODUCTION_FACTOR (default 100) and registration is on.
 *
 * E2E_STACK_MODE=production|non-production says it; otherwise it is detected:
 * an empty POST /auth/register is the app's absent-route 404 only when
 * self-registration is off, which is the production default. A spec asserts
 * the production-only behaviour only in production, and asserts the
 * non-production behaviour (and says so) elsewhere.
 */
export const stackMode = async (): Promise<"production" | "non-production"> => {
  const told = penv["E2E_STACK_MODE"];
  if (told === "production" || told === "non-production") {
    return told;
  }
  modeProbe ??= call("POST", "/auth/register", { body: {}, from: newClientAddress() }).then((probe) =>
    probe.status === 404 && /route not found/i.test(messageOf(probe)) ? "production" : "non-production",
  );
  return modeProbe;
};

/** A fresh client address in 198.18.0.0/15 (RFC 2544 benchmark space). */
export const newClientAddress = (): string => {
  const [a = 0, b = 0, c = 0] = randomBytes(3);
  return `198.${String(18 + (a % 2))}.${String(b)}.${String((c % 254) + 1)}`;
};

/** A short run-unique suffix: letters and digits only (usernames and tenant codes take it). */
export const runStamp = (): string => `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;

// ---------------------------------------------------------------- narrowing

/** `value` as a plain object, or an empty one. */
export const obj = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** `value` as an array, or an empty one. */
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

/** `value` as a string, or "". */
export const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The `data` member of an envelope. */
export const dataOf = (reply: Reply): Record<string, unknown> => obj(obj(reply.body)["data"]);

/** The `message` of an envelope. */
export const messageOf = (reply: Reply): string => str(obj(reply.body)["message"]);

// ---------------------------------------------------------------- principals

/** The operator's session: its token and its home tenant (bootstrap and MFA completed by setup.js). */
export const operatorSession = async (): Promise<{ token: string; tenantId: string }> => {
  const signIn: unknown = await httpPost("/auth/login", { user: OPERATOR, password: OPERATOR_PASSWORD });
  const body = obj(signIn)["body"];
  const token: unknown = extractToken(body);
  if (typeof token !== "string" || token === "") {
    throw new Error(`E2E P10: the operator ${OPERATOR} could not sign in (${String(obj(signIn)["status"])})`);
  }
  return { token, tenantId: str(obj(obj(body)["data"])["tenantId"]) };
};

/** A session token for the operator. */
export const operatorToken = async (): Promise<string> => (await operatorSession()).token;

/** The operator's password (for re-authentication prompts). */
export const operatorPassword = (): string => OPERATOR_PASSWORD;

/** A password the backend's rule accepts (upper, lower, digit, 8+). */
export const strongPassword = (label: string): string => `P10e2e-${label}-${randomBytes(4).toString("hex")}Aa1`;

// ---------------------------------------------------------------- access requests

/** A valid intake body; `workEmail` must be run-unique (the per-address cap is 3 a day). */
export const accessRequestBody = (workEmail: string, organisationName: string): Record<string, unknown> => ({
  organisationName,
  facilityType: "hospital",
  city: "Bandung",
  deviceCountBand: "100_499",
  contactName: "Siti Rahma",
  contactRole: "Kepala IPSRS",
  workEmail,
  whatsapp: "0812-3456-7890",
  needs: "Jadwal kalibrasi dan sertifikat (P10-13 live E2E)",
  consent: true,
  consentVersion: "2026-10-01",
  locale: "en",
  website: "",
});

/** The queue rows (`status`, newest first) with this work email. */
export const queuedFor = async (token: string, workEmail: string, status = "pending"): Promise<Record<string, unknown>[]> => {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= 20; page++) {
    const reply = await call("GET", `/admin/access-requests?status=${status}&page=${String(page)}&limit=100`, { token });
    if (reply.status !== 200) {
      throw new Error(`E2E P10: GET /admin/access-requests answered ${String(reply.status)}`);
    }
    const data = arr(obj(reply.body)["data"]).map(obj);
    rows.push(...data.filter((r) => str(r["workEmail"]) === workEmail.toLowerCase()));
    if (data.length < 100) {
      break;
    }
  }
  return rows;
};

/** Submit a request as a fresh client and return its queue row. */
export const submitAndFind = async (token: string, workEmail: string, organisationName: string): Promise<Record<string, unknown>> => {
  const submitted = await call("POST", "/access-requests", {
    body: accessRequestBody(workEmail, organisationName),
    from: newClientAddress(),
  });
  if (submitted.status !== 202) {
    throw new Error(`E2E P10: the intake answered ${String(submitted.status)}: ${messageOf(submitted)}`);
  }
  const [row] = await queuedFor(token, workEmail);
  if (!row) {
    throw new Error(`E2E P10: the request for ${workEmail} is not in the pending queue`);
  }
  return row;
};

/** A tenant code the validator accepts, unique per run. */
export const tenantCodeFor = (label: string): string => `P10${label}${runStamp()}`.slice(0, 40).toUpperCase();

// ---------------------------------------------------------------- mail (Mailpit)

/** The Mailpit HTTP API, or "" when the stack under test has none. */
export const mailpitUrl = (): string => (penv["E2E_MAILPIT_URL"] ?? "").replace(/\/$/, "");

/** HTML entities as mustache writes them (`&#x2F;`, `&#x3D;`, `&amp;` …) decoded. */
const decodeEntities = (html: string): string =>
  html
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * The newest message to `to` received after `since` whose decoded HTML
 * matches `pattern`; waits up to `timeoutMs` (the email goes through RabbitMQ).
 */
export const waitForMail = async (to: string, pattern: RegExp, since: number, timeoutMs = 45000): Promise<RegExpExecArray> => {
  const base = mailpitUrl();
  if (base === "") {
    throw new Error("E2E P10: E2E_MAILPIT_URL is not set; a mailed secret cannot be read");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`);
    const found = obj(await search.json().catch(() => null));
    for (const message of arr(found["messages"]).map(obj)) {
      if (Date.parse(str(message["Created"])) + 2000 < since) {
        continue;
      }
      const full = obj(await (await fetch(`${base}/api/v1/message/${str(message["ID"])}`)).json().catch(() => null));
      const match = pattern.exec(decodeEntities(`${str(full["HTML"])}\n${str(full["Text"])}`));
      if (match) {
        return match;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`E2E P10: no mail to ${to} matching ${String(pattern)} within ${String(timeoutMs)} ms`);
};

/** The invitation token in the newest invitation mail to `to`. */
export const invitationTokenFor = async (to: string, since: number): Promise<string> => {
  const match = await waitForMail(to, /\/invitation\?token=([A-Za-z0-9_\-%.~]+)/, since);
  return decodeURIComponent(match[1] ?? "");
};

/** The 6-digit reset code in the newest OTP mail to `to`. */
export const resetCodeFor = async (to: string, since: number): Promise<string> => {
  const match = await waitForMail(to, />\s*(\d{6})\s*</, since);
  return match[1] ?? "";
};

// ---------------------------------------------------------------- users and certificates

/** The role with this name, from GET /roles. */
export const roleNamed = async (token: string, name: string): Promise<Record<string, unknown>> => {
  const roles = await call("GET", "/roles?limit=100", { token });
  const role = arr(obj(roles.body)["data"]).map(obj).find((r) => str(r["name"]) === name);
  if (!role) {
    throw new Error(`E2E P10: no role named ${name} in GET /roles (${String(roles.status)})`);
  }
  return role;
};

/**
 * An administrator-created user in the operator's tenant. Its password is a
 * ONE-TIME password (Q-49, ADR-099 Amendment 1): the first sign-in answers a
 * password-change token, not a session.
 */
export const createUserWithOneTimePassword = async (
  token: string,
  tenantId: string,
  roleName: string,
  label: string,
  address?: string,
): Promise<{ id: string; email: string; oneTime: string }> => {
  const stamp = runStamp();
  const email = address ?? `p10-${label}-${stamp}@example.com`;
  const oneTime = strongPassword("once");
  const role = await roleNamed(token, roleName);
  const created = await call("POST", "/users/create", {
    token,
    body: {
      tenantId,
      username: `p10${label}${stamp}`.replace(/[^a-z0-9]/gi, "").slice(0, 30),
      firstName: "Phase",
      lastName: "Ten",
      email,
      password: oneTime,
      roleId: role["id"],
    },
  });
  if (created.status !== 201) {
    throw new Error(`E2E P10: POST /users/create answered ${String(created.status)}: ${messageOf(created)}`);
  }
  return { id: str(dataOf(created)["id"]), email, oneTime };
};

/** Spend a one-time password: sign in once, then set `newPassword` with the change token. */
export const replaceOneTimePassword = async (email: string, oneTime: string, newPassword: string): Promise<void> => {
  const first = await call("POST", "/auth/login", { body: { user: email, password: oneTime }, from: newClientAddress() });
  const changeToken = str(obj(first.body)["token"]);
  if (first.status !== 200 || dataOf(first)["passwordChangeRequired"] !== true || changeToken === "") {
    throw new Error(`E2E P10: the one-time sign-in of ${email} answered ${String(first.status)}`);
  }
  const changed = await call("POST", "/auth/first-sign-in/password", { body: { token: changeToken, newPassword } });
  if (changed.status !== 200) {
    throw new Error(`E2E P10: the first-sign-in change for ${email} answered ${String(changed.status)}: ${messageOf(changed)}`);
  }
};

/** A plain password sign-in (no MFA expected). */
export const signIn = async (identifier: string, password: string): Promise<Reply> =>
  call("POST", "/auth/login", { body: { user: identifier, password }, from: newClientAddress() });

/**
 * A SIGNED certificate in the operator's tenant, and its verification token
 * (what the QR carries): device → record → certificate → submit → approve (a
 * second user: separation of duties) → sign, as automate/smoke.browser.js does.
 */
export const issueSignedCertificate = async (
  token: string,
  tenantId: string,
): Promise<{ id: string; number: string; verificationToken: string; cleanup: () => Promise<void> }> => {
  const stamp = runStamp();
  const approver = await createUserWithOneTimePassword(token, tenantId, "HEALTHCARE ADMIN", "appr");
  const approverPassword = strongPassword("appr");
  await replaceOneTimePassword(approver.email, approver.oneTime, approverPassword);
  const approverSignIn = await signIn(approver.email, approverPassword);
  const approverToken = str(obj(approverSignIn.body)["token"]);

  const device = await call("POST", "/calibration-devices", {
    token,
    body: { name: `P10 Verify Device ${stamp}`, manufacturer: "P10", model: "V-1", serialNumber: `P10-${stamp}`, status: "active" },
  });
  if (device.status !== 201) {
    throw new Error(`E2E P10: creating a device answered ${String(device.status)}: ${messageOf(device)}`);
  }
  const deviceId = str(dataOf(device)["id"]);
  const record = await call("POST", "/calibration-records", { token, body: { deviceId, calibrationDate: "2026-09-29" } });
  if (record.status !== 201) {
    throw new Error(`E2E P10: creating a calibration record answered ${String(record.status)}`);
  }
  const cert = await call("POST", "/certificates", {
    token,
    body: { deviceId, calibrationRecordId: dataOf(record)["id"], type: "calibration", summary: `P10-13 ${stamp}` },
  });
  if (cert.status !== 201) {
    throw new Error(`E2E P10: creating a certificate answered ${String(cert.status)}: ${messageOf(cert)}`);
  }
  const id = str(dataOf(cert)["id"]);
  const number = str(dataOf(cert)["certificateNumber"]);
  const reauth = { authMethod: "password", authPayload: operatorPassword(), meaning: "P10-13 live E2E" };
  const steps: [string, Record<string, unknown>, string][] = [
    ["submit", {}, token],
    ["approve", { ...reauth, authPayload: approverPassword }, approverToken],
    ["sign", { ...reauth, digitalSignature: Buffer.from(`p10-${stamp}`).toString("base64"), digitalSignatureKeyId: "p10" }, token],
  ];
  for (const [step, body, as] of steps) {
    const res = await call("POST", `/certificates/${id}/${step}`, { token: as, body });
    if (res.status !== 200) {
      throw new Error(`E2E P10: certificate ${step} answered ${String(res.status)}: ${messageOf(res)}`);
    }
  }
  const doc = await call("GET", `/certificates/${id}/document`, { token });
  const verifyUrl = str(dataOf(doc)["verifyUrl"]);
  const params = new URL(verifyUrl, "http://placeholder.invalid").searchParams;
  const verificationToken = params.get("token") ?? params.get("t") ?? "";
  if (verificationToken === "") {
    throw new Error(`E2E P10: the signed certificate's verifyUrl carries no token (${verifyUrl})`);
  }
  return {
    id,
    number,
    verificationToken,
    cleanup: async () => {
      await call("DELETE", `/users/delete?userId=${approver.id}`, { token }).catch(() => undefined);
    },
  };
};
