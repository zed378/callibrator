import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosError,
  InternalAxiosRequestConfig,
} from "axios";
import { useAccessDeniedStore } from "@/stores/accessDeniedStore";
import { API_TIMEOUT } from "@/constants";

/** The backend's 403 `code` for an account that must change its password (A-123). */
export const PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";
/** Where such an account is sent. */
export const CHANGE_PASSWORD_PATH = "/dashboard/change-password";

/**
 * A-123 (ADR-051 Q-11): where a failed request should send the browser
 * because the account must change an administrator-set password — or null.
 * The backend answers every route but change-password, logout and "who am I"
 * with 403 + `code: PASSWORD_CHANGE_REQUIRED` until it is changed. Not again
 * once on that page, or it would reload on each of its own background
 * requests.
 */
export const passwordChangeRedirect = (
  status: number | undefined,
  code: string | undefined,
  pathname: string,
): string | null =>
  status === 403 &&
  code === PASSWORD_CHANGE_REQUIRED &&
  pathname !== CHANGE_PASSWORD_PATH
    ? CHANGE_PASSWORD_PATH
    : null;

/** The backend's 403 `code` for an account its tenant requires to enrol MFA (A-160). */
export const MFA_ENROLMENT_REQUIRED = "MFA_ENROLMENT_REQUIRED";
/** Where such an account is sent. */
export const MFA_PATH = "/dashboard/mfa";

/**
 * A-160: where a failed request should send the browser because the user's
 * tenant requires MFA and this account has none — or null. The backend
 * answers every route but the MFA enrolment ones, change-password, logout
 * and "who am I" with 403 + `code: MFA_ENROLMENT_REQUIRED` until it enrols.
 * Not again once on that page (its own background requests would reload it).
 */
export const mfaEnrolmentRedirect = (
  status: number | undefined,
  code: string | undefined,
  pathname: string,
): string | null =>
  status === 403 && code === MFA_ENROLMENT_REQUIRED && pathname !== MFA_PATH
    ? MFA_PATH
    : null;

/**
 * F-07: the one normalised description of a failed request. Every rejection
 * from this client is an Error whose `message` is the backend's own message
 * when it sent one; `describeApiError` reads the rest back off it.
 */
export interface ApiErrorDetails {
  /** HTTP status, or null when no response arrived (network, timeout). */
  status: number | null;
  /** The backend's machine-readable `code`, when it sent one. */
  code: string | null;
  message: string;
  /**
   * The backend's `X-Request-Id` for this request (backend/index.js sets it on
   * every response) — what a user quotes to support. Null when no response.
   */
  requestId: string | null;
  kind: "http" | "timeout" | "network" | "unknown";
}

/** Extra fields this client puts on every rejected AxiosError. */
type AnnotatedError = AxiosError & {
  requestId?: string | null;
  code?: string;
  apiCode?: string | null;
};

/** Read the normalised details back off anything a request rejected with. */
export const describeApiError = (err: unknown): ApiErrorDetails => {
  if (!axios.isAxiosError(err)) {
    return {
      status: null,
      code: null,
      message: err instanceof Error ? err.message : "Request failed",
      requestId: null,
      kind: "unknown",
    };
  }
  const e = err as AnnotatedError;
  const status = e.response?.status ?? null;
  const timedOut = e.code === "ECONNABORTED" || e.code === "ETIMEDOUT";
  return {
    status,
    code: e.apiCode ?? null,
    message: e.message,
    requestId: e.requestId ?? null,
    kind: status !== null ? "http" : timedOut ? "timeout" : e.response ? "unknown" : "network",
  };
};

/**
 * F-05: a 401 from these endpoints is an answer about the credentials the
 * caller just sent (a wrong password, a spent code) — not a session that
 * expired. They never trigger a refresh or a redirect.
 */
const CREDENTIAL_ENDPOINTS = [
  "/api/v1/auth/login",
  "/api/v1/auth/mfa/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/v1/auth/logout-all",
  "/api/v1/auth/sso-session",
  "/api/v1/auth/register",
  "/api/v1/auth/send-otp",
  "/api/v1/auth/reset-password",
  "/api/v1/auth/activation",
];

const isCredentialEndpoint = (url: string | undefined): boolean => {
  const path = (url || "").split("?")[0];
  return CREDENTIAL_ENDPOINTS.includes(path);
};

/** Pages behind the session — the ones proxy.ts guards. */
const isProtectedPath = (pathname: string): boolean =>
  pathname === "/dashboard" || pathname.startsWith("/dashboard/");

/**
 * F-05: where the browser goes when the session cannot be refreshed — the
 * login page, carrying the page to return to. Null off a protected page: a
 * public page (the landing page, /verify, /login itself) has nothing to
 * leave, and navigating from /login to /login is the loop.
 */
export const sessionExpiredRedirect = (
  pathname: string,
  search = "",
): string | null =>
  isProtectedPath(pathname)
    ? `/login?callbackUrl=${encodeURIComponent(pathname + search)}`
    : null;

/**
 * The one place this client leaves the page. A seam so tests can observe
 * navigation (jsdom implements none); production is a plain assignment.
 */
export const browserNavigation = {
  go(url: string): void {
    window.location.assign(url);
  },
};

/** Retry marker: a request is retried at most once after a refresh. */
type RetriableConfig = InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean };

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: "", // Send requests to current Next.js origin for proxying
  timeout: API_TIMEOUT,
  headers: {
    "Content-Type": "application/json",
  },
});

// NOTE: The Authorization header is injected server-side by the API proxy
// (src/app/api/v1/[...path]/route.ts) from the httpOnly auth_token cookie.
// The JWT is deliberately never read from localStorage on the client, so it
// cannot be exfiltrated via XSS.

// Request interceptor: for multipart uploads (FormData bodies), remove the
// default `application/json` Content-Type so the browser sets
// `multipart/form-data; boundary=...` itself. Setting the Content-Type
// manually strips the boundary and makes the backend's multer unable to parse
// the body (uploads silently fail with "field required").
apiClient.interceptors.request.use(
  (config) => {
    if (typeof FormData !== "undefined" && config.data instanceof FormData) {
      if (config.headers) {
        delete (config.headers as Record<string, unknown>)["Content-Type"];
        delete (config.headers as Record<string, unknown>)["content-type"];
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * F-05: one refresh at a time. Every 401 that arrives while a refresh is in
 * flight waits for that same refresh instead of starting another — the
 * backend rotates the refresh token, so a second concurrent refresh would
 * present a token the first one just revoked.
 *
 * Resolves true when the session was renewed, false when it is over (the
 * refresh route has then already cleared every session cookie), and null when
 * the refresh itself could not be reached (the session may be fine).
 */
let refreshInFlight: Promise<boolean | null> | null = null;
const refreshSession = (): Promise<boolean | null> => {
  if (!refreshInFlight) {
    refreshInFlight = apiClient
      .post("/api/v1/auth/refresh", {})
      .then(() => true)
      .catch((err: unknown) => {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        return status === 401 || status === 403 ? false : null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
};

/** F-05: navigate once, however many requests fail together. */
let sessionEndNavigated = false;
const endSession = () => {
  if (typeof window === "undefined" || sessionEndNavigated) return;
  const target = sessionExpiredRedirect(
    window.location.pathname,
    window.location.search,
  );
  if (!target) return;
  sessionEndNavigated = true;
  browserNavigation.go(target);
};

/** Test seam: reset the module's single-flight state between tests. */
export const __resetSessionStateForTests = () => {
  refreshInFlight = null;
  sessionEndNavigated = false;
};

const MUTATING_METHODS = ["post", "put", "patch", "delete"];

// Response interceptor - handle errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    // Extract error message from response body if available
    const responseData = error.response?.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    const errorMessage =
      responseData?.message || responseData?.error || error.message;
    const status = error.response?.status;
    const config = error.config as RetriableConfig | undefined;

    // F-05: an expired session is renewed once and the request retried; a
    // session that cannot be renewed lands on /login ONCE, with its cookies
    // already cleared by the refresh route (so proxy.ts does not bounce
    // /login back to /dashboard on a stale auth_token).
    if (
      status === 401 &&
      config &&
      !config._retriedAfterRefresh &&
      !isCredentialEndpoint(config.url)
    ) {
      const refreshed = await refreshSession();
      if (refreshed) {
        return apiClient.request({ ...config, _retriedAfterRefresh: true } as RetriableConfig);
      }
      if (refreshed === false) {
        endSession();
      }
    }

    // A-123: an account that must change its password goes to the one
    // screen that can clear the flag.
    if (typeof window !== "undefined") {
      // A-160: likewise an account its tenant requires to enrol MFA goes to
      // the MFA page.
      const target =
        passwordChangeRedirect(
          status,
          responseData?.code,
          window.location.pathname,
        ) ??
        mfaEnrolmentRedirect(
          status,
          responseData?.code,
          window.location.pathname,
        );
      if (target) {
        browserNavigation.go(target);
      } else if (
        status === 403 &&
        !isCredentialEndpoint(config?.url) &&
        MUTATING_METHODS.includes((config?.method || "").toLowerCase())
      ) {
        // F-07: an action the caller's role may not take. The screen shows
        // AccessDeniedModal and the menu is re-resolved (DashboardLayout) —
        // the menu offered something the server refuses. A refused READ is
        // left to the screen's own error state: a background read (the
        // health panel, search) must not pop a modal.
        useAccessDeniedStore.getState().show(errorMessage);
      }
    }

    // Attach the detailed error message to the error object
    if (
      error instanceof Error &&
      errorMessage &&
      errorMessage !== error.message
    ) {
      error.message = errorMessage;
    }

    // F-07: the request id and the backend code travel with the rejection.
    const annotated = error as AnnotatedError;
    annotated.requestId =
      (error.response?.headers?.["x-request-id"] as string | undefined) ?? null;
    annotated.apiCode = responseData?.code ?? null;

    return Promise.reject(error);
  },
);

// API methods with generic type support
export const api = {
  get: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    apiClient.get(url, config).then((res) => res.data),

  post: <T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> => apiClient.post(url, data, config).then((res) => res.data),

  put: <T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> => apiClient.put(url, data, config).then((res) => res.data),

  patch: <T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> => apiClient.patch(url, data, config).then((res) => res.data),

  delete: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    apiClient.delete(url, config).then((res) => res.data),
};

export default apiClient;
