/**
 * P22-10a — one field user per browser profile (P19-08 § 11; AM-23; `06` § 9). The registry holds
 * ids, counts and timestamps only — it names nobody, so its messages name nobody.
 */

export interface RegistryRow {
  /** `<tenantId>:<userId>`. */
  readonly key: string;
  readonly outboxCount: number;
  readonly workingSetPresent: boolean;
  readonly lastSyncServerAt: number | null;
}

export const registryKey = (tenantId: string, userId: string): string => `${tenantId}:${userId}`;

export type EnableDecision =
  | { readonly allowed: true; /** Other users' empty rows, deleted silently first. */ readonly removeKeys: readonly string[] }
  | { readonly allowed: false; readonly reason: "other_user_data" };

/**
 * Enabling offline mode (§ 11.1): refused while ANOTHER user's row has an outbox or a working set;
 * another user's empty row is removed silently.
 */
export const canEnable = (rows: readonly RegistryRow[], me: string): EnableDecision => {
  const others = rows.filter((r) => r.key !== me);
  if (others.some((r) => r.outboxCount > 0 || r.workingSetPresent)) return { allowed: false, reason: "other_user_data" };
  return { allowed: true, removeKeys: others.map((r) => r.key) };
};

export interface SignInPlan {
  /** Other users whose working set is dropped WITHOUT opening their outbox. */
  readonly purgeKeys: readonly string[];
  /** How many of another user's captures remain (the count-only note the field app shows). */
  readonly othersPending: number;
}

/** A different user signed in on this profile (§ 11.2): purge the others' working sets; keep their outboxes. */
export const onSignIn = (rows: readonly RegistryRow[], me: string): SignInPlan => {
  const others = rows.filter((r) => r.key !== me);
  return {
    purgeKeys: others.filter((r) => r.workingSetPresent).map((r) => r.key),
    othersPending: others.reduce((n, r) => n + r.outboxCount, 0),
  };
};
