# 2026-09-28 — Data-layer remainders: D-22, D-24, D-25, D-26, D-29

**ADR:** [ADR-083](../DECISIONS.md) · **Migration:** `0088-attachment-file-purged-at` · **Board:** `TASKS/AUDIT-2026-09-DATA.md` rows D-22, D-24, D-25, D-26, D-29

| Card | Now |
|---|---|
| D-22 | **done** except the orphan query on the deployed DB — one type list, project cascade, 90-day deleted-file sweep |
| D-24 | **done** — review check `unboundedFindAll.d24` (24 OPEN reads recorded), `maskAuditTrail` keyset-paged |
| D-25 | **partial by decision** — split pinned (`softDeleteMechanisms.d25`), conversion deferred |
| D-26 | **done** — `enumMirrors.d26` + `pg_enum` comparison in `dataLayer.dbD.live` |
| D-29 | **done** — 0019 index detection by column; fallback contract tested and frozen |

## Changes

- `constants/attachmentResources.js` (new); `models/attachment.model.js` (`knownResourceType`, `filePurgedAt`); `services/attachment.service.js` (type check, array `softDeleteForResource` + `via`, `resolveAbsPath` export).
- `services/attachmentFileSweep.service.js`, `middlewares/attachmentFileSweepScheduler.middleware.js` (new); `jobMonitor.service.js`, `constants/systemActors.js`, `index.js`, both `.env.example`, Helm configmap.
- `services/kanban.service.js#deleteProject`; `services/dataRetention.service.js#maskAuditTrail`.
- `migrations/0088-attachment-file-purged-at.js` (new, registered); `migrations/0019-add-signature-crypto-fields.js` (index match).

## Evidence

- Tests named in ADR-083 § Evidence; all pass on `35ebd76` + this change; fail on `f0d7f08` except the two pinning guards.
- PostgreSQL 18.6: fresh boot and upgrade from `f0d7f08` both applied 0088 and passed schema verification; `dataLayer.dbD.live` 6/6 on both, as the application role.
