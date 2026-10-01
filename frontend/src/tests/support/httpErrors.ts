/**
 * Rejections shaped as `@/api/client` produces them, for tests that mock the
 * client's `api` methods: an AxiosError whose `message` is the backend's own
 * message and whose `response` carries the backend envelope, so
 * `describeApiError` (the real one) reads the same status back.
 */
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

const config = (): InternalAxiosRequestConfig => ({ headers: new AxiosHeaders() });

/** A backend refusal: `{ success: false, status, message, code? }`. */
export const httpError = (status: number, message: string, code?: string): AxiosError => {
  const body = { success: false, status, message, ...(code ? { code } : {}) };
  const err = new AxiosError(message, "ERR_BAD_REQUEST", config(), {}, {
    status,
    statusText: String(status),
    headers: {},
    config: config(),
    data: body,
  });
  return err;
};

/** No response at all — the backend was unreachable. */
export const networkError = (): AxiosError =>
  new AxiosError("Network Error", "ERR_NETWORK", config(), {});
