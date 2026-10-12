# P12-06: the public device page ADR (ADR-138) — a revocable capability token, one exempted read, minimal fields

**Date:** 2026-10-12 · **Task:** P12-06 (Phase 12) · **Decision:** [ADR-138](../DECISIONS.md) · **Working decision implemented:** UD-15 (2026-10-08, [`TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`](../../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) § 3) · **Inputs:** [`docs/UPSTREAM/02-FEATURES.md`](../../docs/UPSTREAM/02-FEATURES.md) F-74, F-75; [`docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md`](../../docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md) P16, EP-23 (FT-106), FT-31

> **Documentation only. Nothing is built.** The ADR is the target that P19-07 (spec), P21-08 (API), P22-08 (page) and P27-03 (stickers) build.

## Decided (under the owner's standing delegation; UD-15 is the working decision it implements)

| # | Decision |
|---|---|
| 1 | Token: 128-bit CSPRNG, 22 base64url characters in `https://<host>/d/<token>`; **only its SHA-256 is stored** (`public_device_tokens`, tenant-scoped); one active token per device; a re-issue revokes the old one in the same transaction; issuing and revoking are audited and allowed to unbound staff only (`equipment` write). |
| 2 | One exempted read: `GET /api/v1/public/devices/:token`, a reviewed entry in `routeGateExemptions.ts`. The only cross-tenant step is a reviewed `skipTenantScope` on the token row; the device is then read in that tenant's context. The global `UNIQUE` index on the hash is a recorded, reviewed exception to the cross-tenant-oracle trap. |
| 3 | One identical 404 for an unknown or revoked token, a deleted device, an ended facility, a suspended or deleted tenant, or the page turned off. A retired device is shown as retired. |
| 4 | Its own rate-limit budget (`publicDevicePage`): per IP plus a global ceiling; failed lookups count double. |
| 5 | Per-tenant setting `public_device_page`: `off` (default) / `minimal` (name, type, make and model, facility name, calibration status and next due date, last IPM date) / `minimal_with_report` (adds the link to the last IPM report's verification page). Never shown: serial, QR number, room, photos, documents, people's names, internal ids. |
| 6 | The envelope (ADR-137), `no-store`, `noindex`, `no-referrer`; logs carry a token-hash prefix only; no audit row per view. |
| 7 | The page `/d/[token]` in the `(public)` group, per request under the nonce CSP, ID/EN, readable without JavaScript, within the `/verify/*` budget. |
| 8 | Legacy stickers do not reach this page. They are UD-16's branches, designed in P19-07 once OA-4 is known. |

## Board changes

- P12-06 → **DONE** (ADR-138). Phase 12: 6 DONE · 1 TODO (P12-05).
- **P19-07 → TODO (unblocked).** P12-06 is done, and UD-16 is a working decision whose two branches are both designed. The spec writes both branches; OA-4 only chooses which one applies.
- Downstream, unchanged until their dependencies land: P21-08 (blocked on P19-07), P22-08 (on P21-08), P27-03 (on P22-08).

## Gates (documentation card)

| Gate | Result |
|---|---|
| Links in the ADR, this record, the board rows | resolve (checked by path: `MEMORY/DECISIONS.md`, `TASKS/PHASE-12…`, `TASKS/PHASE-19…`, `docs/UPSTREAM/02-FEATURES.md`, `docs/SECURITY/15-…`) |
| House ADR format | title, Date · Status · Card · Builds in · Works with · Record; Context; Decision; Alternatives considered (table); Implications including the bad ones; `docs/` amended |
| Code | none changed |

## Open

- `docs/SECURITY/15` EP-23 still says "UD-15 / P12-06 open". It changes to ADR-138 when P21-08 builds the control (the ADR says so), not quietly now.
- The per-IP and global numbers of the rate limit are set in P21-08 against the dry-run sticker count.
