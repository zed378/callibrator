/**
 * Phase 10 (ADR-098) — where a request came from, as an audit row or a
 * hashed-address field records it: the client address Express derived
 * (`req.ip`, A-16 — never a raw header) and the user agent. Never the body.
 */
import type { Request } from "express";

/** The request's client address and user agent, each null when absent. */
export interface RequestOrigin {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export const requestOriginOf = (req: Pick<Request, "ip" | "headers">): RequestOrigin => {
  const userAgent = req.headers["user-agent"];
  return { ip: req.ip ?? null, userAgent: typeof userAgent === "string" ? userAgent : null };
};

/** The acting principal's id (set by `auth`), as a string. */
export const actorIdOf = (req: Pick<Request, "user">): string => String((req.user as { id: unknown }).id);
