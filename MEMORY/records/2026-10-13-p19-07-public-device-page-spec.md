# P19-07: the public device page spec — token, table, three staff routes, one exempted read, one 404, budgets, setting, page, legacy boundary

**Date:** 2026-10-13 · **Task:** P19-07 (Phase 19) · **Spec:** [`MEMORY/specs/P19-07-public-device-page.md`](../specs/P19-07-public-device-page.md) · **Decision:** [ADR-138 Amendment 1](../DECISIONS.md) · **Builds in:** P21-08 (backend), P22-08 (page and staff UI), P27-02 / P27-03 (legacy notice, stickers)

> **Documentation only. Nothing is built.**

## What the spec fixes

- `public_device_tokens`: hash only (64 hex, global UNIQUE — ADR-138's reviewed exception), partial UNIQUE one active per device, append-mostly trigger, no DELETE grant, tenant-scoped and not facility-scoped (no bound principal reaches a route that reads it).
- Staff routes under `/calibration-devices/:id/public-token`: `GET` state, `POST` issue, `POST /rotate`, `DELETE` revoke; `calibration` write, `denyApiKey`, `denyPlatformAuthoring`; unbound only by the facility route gate; one audit row each in the transaction; the token returned once.
- `GET /api/v1/public/devices/:token`: the exemption text, the `FACILITY_SCOPE_SKIPS` entry, the two-tenant guard's allow-list; the order of work; one 404 body (`PUBLIC_DEVICE_NOT_FOUND`) for nine causes; an allow-list answer builder; `no-store`, `noindex`, `no-referrer`; the token redacted in logs.
- The setting `public_device_page` in `TENANT_ADMIN_SETTING_KEYS` (the existing audited `PATCH /tenants/settings`); unknown values read as `off`.
- `/d/[token]`: a server component, readable without JavaScript, the client address forwarded to the budget, ID/EN, one `<main>` / `<h1>`, a bundle-budget entry; the staff panel and a sticker dialog that renders the QR in the browser and stores nothing.
- Threat rows FT-106, FT-107, PD-1 … PD-9 and a test plan with named test files.

## Gaps found (ADR-138 Amendment 1)

1. The gate slug: `calibration` write, not `equipment` (every device write gates on `calibration`).
2. **Legacy branch (b) cannot redirect to `/d/<token>`**: only the hash is stored. It becomes a static "sticker replaced" notice that links to the signed-in QR lookup. UD-16 is a working decision; the owner may revise; OA-4 still chooses the branch.
3. The timing class: bounded, not padded.
4. The public status vocabulary adds `not_scheduled`; an IPM's calibration request reads `due_soon`.
5. `minimal_with_report` discloses what the printed report discloses; the UI says so.
6. Issue, rotate and revoke are separate routes with 409s (`PUBLIC_TOKEN_ACTIVE`, `PUBLIC_TOKEN_NONE`).
7. Deleting a device revokes its token.
8. Budgets: 120 per address, 30 misses per address, 3 000 global, each per 15 min.
9. Log redaction for the backend and nginx.

## Board changes

- P19-07 → **DONE**. Phase 19: 8 DONE.
- P21-08 → **TODO** (unblocked: its dependency is P12-06 on the board, and the spec is written).
- `docs/SECURITY/15` EP-23 is still not changed: it changes when P21-08 builds the control (ADR-138).

## Gates (documentation card)

| Gate | Result |
|---|---|
| Code paths cited in the spec | read at HEAD `f2a2d70` (listed in the spec's "Code read") |
| Links: spec, ADR amendment, record, board rows | resolve by path |
| Code | none changed |
