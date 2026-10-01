/**
 * P10-02 (doc 20 §5 item 7, §7.4): backend answers shown on a public page are
 * mapped by STATUS and CODE to dictionary strings. The backend's English
 * `message` is never rendered on a public page.
 */
import type { AxiosError } from "axios";
import type { MessageKey } from "./messages/id";

export interface ApiFailure {
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  /** The backend's machine-readable `code`, when it sent one. */
  code: string | null;
  /** Seconds from the 429's body `retryAfter` or its `Retry-After` header. */
  retryAfterSeconds: number | null;
  /** The raw body, for callers that read field details (400). */
  body: unknown;
}

const toSeconds = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
};

/**
 * `axios.isAxiosError`, without importing axios: that function is exactly this
 * check. P10-13: the value import put axios (~18 KB compressed) into the
 * verification page, which uses `fetch` and only needs `minutesFrom`.
 */
const isAxiosError = (err: unknown): err is AxiosError =>
  typeof err === "object" && err !== null && (err as { isAxiosError?: unknown }).isAxiosError === true;

/** Reads status, code and retry-after from any rejection of the api client or fetch wrapper. */
export const readApiFailure = (err: unknown): ApiFailure => {
  if (isAxiosError(err)) {
    const body = err.response?.data as { code?: unknown; retryAfter?: unknown } | undefined;
    const annotated = err as { apiCode?: string | null };
    const header = err.response?.headers?.["retry-after"] as unknown;
    return {
      status: err.response?.status ?? null,
      code: (typeof body?.code === "string" ? body.code : null) ?? annotated.apiCode ?? null,
      retryAfterSeconds: toSeconds(body?.retryAfter) ?? toSeconds(header),
      body: err.response?.data ?? null,
    };
  }
  if (err && typeof err === "object" && "status" in err) {
    const e = err as { status?: unknown; code?: unknown; retryAfterSeconds?: unknown; body?: unknown };
    return {
      status: typeof e.status === "number" ? e.status : null,
      code: typeof e.code === "string" ? e.code : null,
      retryAfterSeconds: toSeconds(e.retryAfterSeconds),
      body: e.body ?? null,
    };
  }
  return { status: null, code: null, retryAfterSeconds: null, body: null };
};

/** minutes = ceil(retryAfter / 60), at least 1 (doc 20 §7.4). */
export const minutesFrom = (seconds: number | null): number => Math.max(1, Math.ceil((seconds ?? 60) / 60));

export interface MappedMessage {
  key: MessageKey;
  values?: Record<string, number | string>;
}

/**
 * The sign-in step's answer → the sentence shown (doc 20 §7.4). A 403 is the
 * tenant check unless it carries a network-policy code.
 */
export const signInMessage = (failure: ApiFailure, step: "password" | "mfa" = "password"): MappedMessage => {
  const { status, code, retryAfterSeconds } = failure;
  if (status === null) return { key: "auth.error.network" };
  if (code === "LOCATION_REQUIRED") return { key: "auth.error.locationRequired" };
  if (code === "NETWORK_POLICY") return { key: "auth.error.networkPolicy" };
  if (status === 429) return { key: "auth.error.rateLimited", values: { minutes: minutesFrom(retryAfterSeconds) } };
  if (status === 423) {
    return retryAfterSeconds
      ? { key: "auth.error.locked", values: { minutes: minutesFrom(retryAfterSeconds) } }
      : { key: "auth.error.lockedNoTime" };
  }
  if (status === 403) return { key: "auth.error.suspended" };
  if (step === "mfa") {
    // The MFA token (not the code) expired: sign in again (05 §5.2).
    if (status === 401 && (code === "MFA_TOKEN_EXPIRED" || code === "TOKEN_EXPIRED")) {
      return { key: "auth.error.mfaExpired" };
    }
    if (status === 400 || status === 401) return { key: "auth.error.mfa" };
  }
  if (status === 401 || status === 400) return { key: "auth.error.credentials" };
  return { key: status >= 500 ? "auth.error.network" : "auth.error.generic" };
};

/** A-188: the `?error=` codes the backend's SSO callbacks return with. */
export const SSO_ERROR_KEYS: Record<string, MessageKey> = {
  sso_state: "auth.sso.state",
  sso_unavailable: "auth.sso.unavailable",
  sso_account_refused: "auth.sso.accountRefused",
  sso_failed: "auth.sso.failed",
  sso_error: "auth.sso.error",
};

export const ssoErrorKey = (code: string | null): MessageKey | null =>
  code ? (SSO_ERROR_KEYS[code] ?? "auth.sso.failed") : null;
