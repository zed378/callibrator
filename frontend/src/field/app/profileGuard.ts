/**
 * P22-10c1 — the profile guard's browser entry (P19-08 § 11.2, AM-23), loaded with `import()` by
 * the authenticated shells ONLY when the profile carries the field flag, so a profile that never
 * enabled field mode downloads none of this.
 */
import { fieldProfileGuard } from "./runtime";

export interface GuardBrowser {
  readonly indexedDB?: IDBFactory;
  readonly localStorage?: Storage;
}

/** Drops every other user's working set on this profile; their outboxes stay encrypted and untouched. */
export const runFieldProfileGuard = async (browser: GuardBrowser, user: { id: string; tenantId: string }): Promise<{ purged: number; othersPending: number } | null> => {
  if (!browser.indexedDB) return null;
  return fieldProfileGuard({ idb: browser.indexedDB, flags: browser.localStorage ?? null }, user);
};
