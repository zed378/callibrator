/**
 * P22-10a — every answer classified (P19-08 § 9.3, § 9.6; `06` § 8):
 *
 * | Answer | Outcome |
 * |---|---|
 * | 2xx (a replayed key answers the stored status, body re-read now) | `success` |
 * | network failure, timeout, 5xx, 429, 409 `IDEMPOTENCY_IN_FLIGHT` | `retry` the SAME frozen op |
 * | 409 `IDEMPOTENCY_KEY_REUSED` | `replan` once with a new key (a client defect), then attention |
 * | 403 with a scope-loss code | `scope_lost` (purge; the capture waits) |
 * | anything else (404, 400, 403, 409 with its code, 413, 415 …) | `attention` — the capture's queue stops |
 *
 * Nothing is dropped here: dropping needs a confirmed user action.
 */
import { isScopeLossCode } from "@callibrator/contracts/clientFacilities";
import type { Answer } from "./model";

export type Outcome =
  | { readonly kind: "success" }
  | { readonly kind: "retry"; readonly retryAfterSec: number | null }
  | { readonly kind: "replan" }
  | { readonly kind: "scope_lost"; readonly code: string }
  | { readonly kind: "attention" };

/** A request that never got an answer (no network, a timeout): retried. */
export const NO_ANSWER: Outcome = Object.freeze({ kind: "retry", retryAfterSec: null });

export const classify = (answer: Answer): Outcome => {
  if (answer.status >= 200 && answer.status < 300) return { kind: "success" };
  if (answer.status >= 500 || answer.status === 429 || answer.status === 408) return { kind: "retry", retryAfterSec: answer.retryAfterSec };
  if (answer.status === 409 && answer.code === "IDEMPOTENCY_IN_FLIGHT") return { kind: "retry", retryAfterSec: answer.retryAfterSec };
  if (answer.status === 409 && answer.code === "IDEMPOTENCY_KEY_REUSED") return { kind: "replan" };
  if (answer.status === 403 && isScopeLossCode(answer.code)) return { kind: "scope_lost", code: answer.code as string };
  return { kind: "attention" };
};
