/**
 * P21-15 (ADR-140) — the public e-signature verification page's one read, made by the SERVER
 * component `/s/[id]` so the verdict is readable without JavaScript (as lib/publicDevice.server).
 *
 * SERVER-ONLY. Typed off the generated contract (`paths`); never cached (`no-store`: a revocation
 * shows the moment it happens). The client's address and the original scheme go with it (A-16,
 * A-310), so the backend's per-address budget counts the reader, not Next.
 *
 * One of four outcomes — the page never shows more than the backend said: `ok` with the verdict;
 * `not_found` for the backend's one 404; `rate_limited` for a 429; `failed` for anything else.
 */
import { API_BASE_URL } from "@/constants";
import type { DataOf, Op } from "@/api/typed";
import { clientIpHeader } from "./clientIp";
import { forwardedOriginHeaders } from "./forwardedOrigin";

/** The verdict, exactly as the contract publishes it. */
export type PublicEsignature = DataOf<Op<"/api/v1/public/esignatures/{applicationId}", "get">>;

export type PublicEsignatureOutcome =
  | { kind: "ok"; verdict: PublicEsignature }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "failed" };

/**
 * Read one application's verdict.
 *
 * @param applicationId - the path segment as the browser sent it (the backend answers a malformed one with its 404)
 * @param token - the link's `t` (empty when absent: the same 404)
 * @param incoming - the incoming request's headers (`headers()` from next/headers)
 * @param fetchImpl - injectable for tests
 * @returns the outcome
 */
export async function readPublicEsignature(applicationId: string, token: string, incoming: Headers, fetchImpl: typeof fetch = fetch): Promise<PublicEsignatureOutcome> {
  try {
    const res = await fetchImpl(`${API_BASE_URL}/api/v1/public/esignatures/${encodeURIComponent(applicationId)}?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      headers: { Accept: "application/json", ...clientIpHeader(incoming), ...forwardedOriginHeaders(incoming, "http:") },
    });
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 429) return { kind: "rate_limited" };
    if (!res.ok) return { kind: "failed" };
    const body = (await res.json()) as { data?: PublicEsignature | null };
    return body.data ? { kind: "ok", verdict: body.data } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/** A specimen SVG as an `<img>` source: an image never runs script, whatever the SVG holds. */
export const specimenDataUri = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
