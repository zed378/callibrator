import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from "axios";
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

// Response interceptor - handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Extract error message from response body if available
    const responseData = error.response?.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    const errorMessage =
      responseData?.message || responseData?.error || error.message;

    if (error.response?.status === 401) {
      // Token expired or invalid - redirect to login. The httpOnly auth
      // cookies are cleared server-side on logout/verify failure.
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }

    // A-123: an account that must change its password goes to the one
    // screen that can clear the flag.
    if (typeof window !== "undefined") {
      const target = passwordChangeRedirect(
        error.response?.status,
        responseData?.code,
        window.location.pathname,
      );
      if (target) {
        window.location.href = target;
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
