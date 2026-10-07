# Faskes-scope and offline-PWA threat model (P17-06)

**Date:** 2026-10-07 · **Card:** P17-06 → DONE · **Base:** working tree after `bec925f` (nothing
committed) · **Deliverable:** [`docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md`](../../docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md)
· **Decisions:** none taken. The document proposes 29 additions (AM-1 … AM-29) for the building
cards to record as ADR amendments under the deviation protocol, and 12 open questions.
**Everything in it is TARGET — nothing is built.**

## What was done

1. Read CLAUDE.md, the Phase 12 index (§ 2 DoD, § 3 decisions), Phase 17, ADR-048, ADR-073,
   ADR-124 … ADR-127, `docs/SECURITY/05` (with the ADR-124 target section), `docs/UPSTREAM/06-DPIA.md`
   (R-04, R-12, R-13), `00-OVERVIEW.md` § 9 (S-01 … S-18) and § 10, `05-DATA-MIGRATION.md` § 3–4,
   `08-FILE-POLICY.md` § 7–8.
2. Read the code the design extends: `utils/tenantScope.util.ts`, `middlewares/tenantContext.middleware.ts`,
   `middlewares/auth.middleware.ts` (API keys, impersonation, super-admin headers, `optionalAuth`),
   `middlewares/rbac.middleware.ts`, `utils/sql.util.ts`, `utils/jobContext.util.ts`, `config/socket.ts`,
   `services/notification.service.ts`, `services/dashboardCache.service.ts`,
   `services/attachment.service.ts` (signed URLs), `services/storage/{keys,signing}.ts`,
   `services/storedFile.service.ts`, `services/sso.service.ts` (JIT), `services/scim.service.ts`,
   `services/search.service.ts`, the `apiKeys`, `attachments`, `tenantBackup` routes, and the
   `memoryDb` / `twoTenantSuite` fixtures.
3. Wrote `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md`: assets (A1–A9), 16 principal types,
   trust boundaries BF-1 … BF-5 with a mermaid data-flow diagram, STRIDE over 24 enforcement points
   (FT-01 … FT-109, each with L × I, the specified control, the residual and the named existing or
   proposed test/guard), the 11 scenarios the card asked for (§ 7), LINDDUN (§ 8), findings in today's
   code (F-1 … F-10), the additions AM-1 … AM-29, the **pre-invitation gate** G-01 … G-31 (§ 11), the
   P17-07 cases PT-01 … PT-33 (§ 12), open questions OQ-1 … OQ-12, residual summary.
4. Mid-task, the P19-01 agent (via the coordinator) asked for a threat on identifying text in global
   catalogue content: added as FT-108 with the spec's controls (acceptance copies nothing, `notes`
   operator-only) and AM-29 (advisory lint on publish).
5. Cross-references: `docs/SECURITY/05` (target section), `docs/SECURITY/01` (pointer),
   `docs/README.md` (SECURITY 16 files). Status: Phase 17 (P17-06 DONE; P17-07's scope fixed to § 12,
   entry = § 11 green), Phase 12 (phase row, totals 16 DONE · 4 TODO · 1 WIP · 75 BLOCKED, the
   build-order sentence points at the gate), `TASKS/PROGRESS.md`, `MEMORY/CHANGELOG.md`, this index.

## Main findings (from reading the code; no code changed)

- **F-7 / FT-37 (the highest impact):** a bound `HEALTHCARE ADMIN` is level 8, the `TENANT_ADMIN`
  tier, and passes every `rbac([TENANT_ADMIN])` gate (`allowHigher`). ADR-124's marker guard names
  `rbac` and `superAdminOnly` only; tenant-admin routes also use `abac(…, { checkTenant: true })`
  (`tenantBackup.route.ts`) and `dynamicAccess` slugs → AM-11 widens the refusal criteria.
- **F-5 / FT-44:** SSO JIT creates an unbound `USER` (`sso.service.ts:294`), SCIM unbound users with
  any non-SUPERADMIN role → a facility employee provisioned that way sees every facility → AM-15.
- **F-1 / FT-75:** attachment signed URLs take an unbounded `expiresInSec` from the body and bind only
  `(id, exp)` — survives a move or deactivation → AM-22. The tenant-level cap is independent of
  ADR-124 (OQ-7: a backlog item for the coordinator to file).
- **F-2, F-6 / FT-64, FT-67:** every socket joins `tenant_<id>`; the 60-s re-check never rebuilds the
  context or rooms.
- **F-3 / FT-61:** the dashboard cache key is per tenant and documents that figures do not vary inside
  a tenant — false for bound principals.
- **Stale grants (FT-46, FT-92, FT-95, FT-96):** HTTP re-reads the user row per request, but sockets,
  PWA data, idempotency replays and signed URLs do not → AM-1 (a binding change revokes sessions;
  the PWA purges on 401 and on the account/facility 403s), AM-25, AM-26.
- **Shared phones (FT-86):** a per-user IndexedDB name with a non-extractable key is not a boundary
  between users of one browser profile (non-extractable prevents export, not use) → AM-23.
- **Import (FT-100, FT-102):** a client account with zero or several facility mappings must never be
  imported unbound (AM-27); `id_map` has no facility column (AM-28). **F-10:** `05-DATA-MIGRATION.md`
  § 3.1 step 1 still reads `tenants ← mst_faskes` (pre-ADR-124); left for P24-01 to correct, not edited here.
- **F-9:** `memoryDb` refuses raw SQL and has no FKs/triggers, so the gate needs live twins (G-04,
  G-14, G-25).

## Verification

Documentation only. No test was run, and none is claimed. Every existing test name cited was found
on disk on 2026-10-07 (`find backend/src/tests …`); every other name is marked *proposed*. Counts in
the document (29 `skipTenantScope: true` opt-outs, 46 lines naming it) are greps of `services`,
`controllers`, `middlewares`, `utils` on the same day — re-count before quoting.

## Privacy

No upstream data was opened; no real value (name, facility, serial, room, credential) appears in the
document or this record. The pentest setup is synthetic only.

## Next

P18-03 (facility-accessible list, `FACILITY_READABLE`, AM-8/AM-11/AM-14), P19-04 (AM-1, AM-3, OQ-1),
P19-08 (AM-16, AM-23 … AM-26), P20-07 (AM-7, G-25), P21-09 (most AM-n, G-01 … G-24), P24-01/02
(AM-27, AM-28, F-10), P17-07 (§ 12, after § 11 is green).
