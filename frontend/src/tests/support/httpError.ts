/**
 * A rejection shaped as `@/api/client` rejects: an AxiosError whose `message`
 * is the backend's own message (the client's response interceptor copies it
 * over), with the backend's error envelope on `response.data` and the
 * backend `code` on `apiCode`. Page tests that mock `@/api/client` use it so
 * the error a screen handles is the one the real client hands it.
 */
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";

export function httpError(status: number, message: string, code?: string): AxiosError {
  const headers = new AxiosHeaders();
  const response: AxiosResponse = {
    status,
    statusText: String(status),
    headers: {},
    config: { headers },
    data: { success: false, status, message, ...(code ? { code } : {}) },
  };
  const err = new AxiosError(message, String(status), { headers }, undefined, response);
  return Object.assign(err, { apiCode: code ?? null, requestId: null });
}

/** A request that never got a response (the server is unreachable). */
export function networkError(): AxiosError {
  return new AxiosError("Network Error", "ERR_NETWORK", { headers: new AxiosHeaders() });
}
