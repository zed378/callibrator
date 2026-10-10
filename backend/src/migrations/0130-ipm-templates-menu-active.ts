/**
 * Migration 0130 — P22-01 landed (the IPM checklist administration page, `/dashboard/ipm-templates`):
 * its menu entry `ipm-templates` is turned ON (ADR-124 Am. 5 § 2: the three P20-06 entries stay
 * inactive until their pages ship; ADR-126 Am. 6 § 8). `seedMenuGroups.util.ts` seeds it active from
 * now on; this does the same on an already-seeded database (the seed never updates one).
 *
 * Idempotent: one UPDATE by slug — a database without the entry (not seeded) is left alone, a second
 * run changes nothing. `ipm` and `client-facilities` stay inactive until their pages land. The grants
 * are untouched (0124 wrote them; the gates read a grant whatever the flag) — only the sidebar changes.
 * `down` turns the entry off again.
 *
 * No try/catch: a failure fails the migration (CLAUDE.md). Verify with psql:
 *   SELECT slug, is_active FROM menu_groups WHERE slug IN ('ipm', 'ipm-templates', 'client-facilities');
 * Cache note (as 0124): the menu tree is cached; flush `<prefix>menu*` / `<prefix>permissions:*` or
 * wait for the TTL.
 */
import type { QueryInterface } from "sequelize";

/** The entry this migration switches (frozen 2026-10-09). */
const SLUG = "ipm-templates";

const setActive = async (context: QueryInterface, active: boolean): Promise<void> => {
  await context.sequelize.query("UPDATE menu_groups SET is_active = $1, updated_at = now() WHERE slug = $2 AND is_active IS DISTINCT FROM $1", {
    bind: [active, SLUG],
  });
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => setActive(context, true);

const down = async ({ context }: { context: QueryInterface }): Promise<void> => setActive(context, false);

export = { SLUG, up, down };
