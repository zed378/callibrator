/**
 * P22-08 (ADR-138 § 7; spec MEMORY/specs/P19-07-public-device-page.md § 10) — the public device
 * page's one read, made by the SERVER component `/d/[token]` so the page is readable without
 * JavaScript.
 *
 * SERVER-ONLY. Per the Next 16 docs a Server Component fetches the backend directly (lib/content.api
 * does the same); the request is typed off the generated contract (`paths`), so a path or a field
 * the backend does not publish is a compile error. Never cached (`no-store`: the answer changes the
 * moment a link is revoked or the page is turned off). The client's address and the original scheme
 * go with it (A-16, A-310), so the backend's per-address budget counts the scanner, not Next.
 *
 * The answer is one of four outcomes — the page never shows more than the backend said:
 *  - `ok` with the data; `not_found` for the backend's one 404; `rate_limited` for a 429; `failed`
 *    for anything else (a 5xx, an unreachable backend, a body that is not the envelope).
 */
import { API_BASE_URL } from "@/constants";
import type { DataOf, Op } from "@/api/typed";
import { clientIpHeader } from "./clientIp";
import { forwardedOriginHeaders } from "./forwardedOrigin";

/** The page's data, exactly as the contract publishes it. */
export type PublicDevice = DataOf<Op<"/api/v1/public/devices/{token}", "get">>;

export type PublicDeviceOutcome =
  | { kind: "ok"; device: PublicDevice }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "failed" };

/**
 * Read a sticker's page.
 *
 * @param token - the path segment as the browser sent it (never validated here: the backend answers
 *   every malformed token with its one 404)
 * @param incoming - the incoming request's headers (`headers()` from next/headers)
 * @param fetchImpl - injectable for tests
 * @returns the outcome
 */
export async function readPublicDevice(token: string, incoming: Headers, fetchImpl: typeof fetch = fetch): Promise<PublicDeviceOutcome> {
  try {
    const res = await fetchImpl(`${API_BASE_URL}/api/v1/public/devices/${encodeURIComponent(token)}`, {
      cache: "no-store",
      headers: { Accept: "application/json", ...clientIpHeader(incoming), ...forwardedOriginHeaders(incoming, "http:") },
    });
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 429) return { kind: "rate_limited" };
    if (!res.ok) return { kind: "failed" };
    const body = (await res.json()) as { data?: PublicDevice | null };
    return body.data ? { kind: "ok", device: body.data } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
