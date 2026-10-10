/**
 * P22-10b — the engine's `Transport` over the app's API client (P19-08 § 9.3: "the typed client …
 * through `api`, so refresh-once, the gate redirects and the error normalisation are the
 * dashboard's").
 *
 *  - `send` puts a FROZEN request on the wire exactly: the key as `Idempotency-Key`, the body text
 *    as it was frozen (never re-serialised — the server's request hash must match on a retry), a
 *    photo as multipart with its form fields; plus `X-Field-Client: 1` (the access log only, never
 *    trusted). Any HTTP answer resolves as an `Answer` (status, top-level `code`, message, `draftId`,
 *    `Retry-After`, the `Date` header); no answer rejects; a 401 that survived the client's
 *    refresh-once is `SessionEnded` (the engine purges; the outbox stays).
 *  - `verify` is `POST /auth/verify`: the scope fingerprint (AM-26) and the server's `Date`.
 */
import type { AxiosError, AxiosInstance, AxiosResponse, RawAxiosRequestHeaders } from "axios";
import type { Answer, FrozenRequest } from "../engine/model";
import { SessionEnded, type Transport } from "../engine/ports";

const headerOf = (headers: unknown, name: string): string | null => {
  if (!headers || typeof headers !== "object") return null;
  const h = headers as { get?: (n: string) => unknown } & Record<string, unknown>;
  const v = typeof h.get === "function" ? h.get(name) : (h[name] ?? h[name.toLowerCase()]);
  return typeof v === "string" ? v : null;
};

const dateOf = (headers: unknown): number | null => {
  const text = headerOf(headers, "date");
  const ms = text ? Date.parse(text) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

const retryAfterOf = (headers: unknown, body: Record<string, unknown>): number | null => {
  const fromBody = body["retryAfter"];
  if (typeof fromBody === "number" && fromBody >= 0) return fromBody;
  const n = Number(headerOf(headers, "retry-after"));
  return Number.isFinite(n) && n >= 0 && headerOf(headers, "retry-after") !== null ? n : null;
};

const toAnswer = (response: AxiosResponse): Answer => {
  const body = response.data !== null && typeof response.data === "object" ? (response.data as Record<string, unknown>) : {};
  const ok = response.status >= 200 && response.status < 300;
  return {
    status: response.status,
    data: ok ? (body["data"] ?? null) : null,
    code: typeof body["code"] === "string" ? body["code"] : null,
    message: typeof body["message"] === "string" ? body["message"] : "",
    draftId: typeof body["draftId"] === "string" ? body["draftId"] : null,
    retryAfterSec: retryAfterOf(response.headers, body),
    serverDate: dateOf(response.headers),
  };
};

const isAxiosError = (err: unknown): err is AxiosError => typeof err === "object" && err !== null && (err as { isAxiosError?: unknown }).isAxiosError === true;

/** The engine's transport over an axios instance with the app's interceptors (the app passes `apiClient`). */
export function createTransport(client: AxiosInstance): Transport {
  const call = async (run: () => Promise<AxiosResponse>): Promise<Answer> => {
    try {
      return toAnswer(await run());
    } catch (err) {
      if (isAxiosError(err) && err.response) {
        if (err.response.status === 401) throw new SessionEnded();
        return toAnswer(err.response);
      }
      throw err;
    }
  };

  return {
    send(request: FrozenRequest, photo: Blob | null) {
      const headers: RawAxiosRequestHeaders = { "Idempotency-Key": request.idempotencyKey, "X-Field-Client": "1" };
      let data: unknown;
      if (request.photo) {
        const form = new FormData();
        for (const [k, v] of Object.entries(request.photo.fields)) form.append(k, v);
        if (photo) form.append("file", photo, `${request.photo.photoId}.jpg`);
        data = form;
      } else {
        // The frozen text itself, never re-serialised (a retry's bytes must be identical).
        data = request.bodyText ?? "";
        headers["Content-Type"] = "application/json";
      }
      return call(() => client.request({ method: request.method, url: request.path, data, headers, transformRequest: [(d: unknown) => d] }));
    },

    read(path: string) {
      return call(() => client.request({ method: "GET", url: path, headers: { "X-Field-Client": "1" } }));
    },

    async verify() {
      const answer = await call(() => client.request({ method: "POST", url: "/api/v1/auth/verify", headers: { "X-Field-Client": "1" } }));
      const data = answer.data !== null && typeof answer.data === "object" ? (answer.data as Record<string, unknown>) : {};
      if (answer.status !== 200 || typeof data["scopeFingerprint"] !== "string") throw new Error(answer.message || "verify failed");
      return { scopeFingerprint: data["scopeFingerprint"], serverDate: answer.serverDate };
    },
  };
}
