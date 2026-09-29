# Debate C-3: Does a tenant on its own storage bucket count against `limitStorageMb`? (Q-06)

Debate paper · 2026-09-27/28 · decided in **ADR-084** (`../MEMORY/DECISIONS.md`). Both positions, then the referee.

## The behaviour as the code had it (read 2026-09-27)

- `quota.service#getStorageUsageMb` sums `attachments.size` for the tenant; `enforceStorageQuota` refuses an upload
  past `tenants.limitStorageMb` with 413. It never looks at where the bytes are.
- `services/storage/config.service.js`'s header said the opposite: *"A tenant that brings its own bucket pays its own
  storage bill and is no longer bounded by the platform's per-tenant quota."* Documentation and code disagreed.
- **Decisive fact:** the attachment request path was never cut over to the storage module
  (`docs/STORAGE/04-TENANT-STORAGE.md` "Read This First"). Every upload is written by multer to platform disk
  (`uploads/attachments/`) whatever the tenant configured. The migration tool copies an attachment into the tenant's
  storage and **leaves the legacy file in place** (non-destructive by design). So today a tenant with its own bucket
  still occupies platform storage for every byte it uploads.

## Position A — compliance and cost first: keep counting

1. The quota bounds the platform's disk, backups and virus scanning. All of that is still spent on a bring-your-own
   tenant, because the bytes land on platform storage first and stay there.
2. Exempting the tenant would give it unbounded platform disk — a denial-of-service on every other tenant sharing
   the volume, and a backup that grows without limit.
3. The config header is the defect; fix the comment, not the quota.

**Concedes:** once bytes genuinely live only in the tenant's bucket, counting them is charging the tenant for
capacity it pays for itself.

## Position B — operability first: stop counting

1. A tenant that configured its own bucket was told (by the module and its UI) that it is spending its own capacity.
   A 413 at the platform limit reads to them as a defect.
2. A refused upload of a calibration certificate is itself a compliance problem: evidence that cannot be attached.

**Concedes:** B's argument assumes the bytes are in the tenant's bucket. They are not, today. B withdraws the exemption
for now and keeps two demands: the refusal must say why, and the exemption must arrive with the cutover.

## Referee's decision (ADR-084, Q-06)

**The quota bounds what the platform holds. Today that is every byte, so a tenant on its own bucket still counts.**

- No behaviour change to the count. `quota.service.js` states the rule; the false claim in
  `storage/config.service.js` is corrected.
- A refusal to a tenant with its own storage configured **says why** ("uploads are still written to platform storage,
  so they count against this limit"). An unreadable storage configuration explains nothing and still answers 413,
  never 500.
- **When the cutover lands**, the exemption is **per attachment, not per tenant**: an attachment whose bytes live only
  in the tenant's own storage stops counting, in `getStorageUsageMb`. A per-tenant switch would exempt the platform-held
  legacy copies too.
- Pinned by `quota.ownBucket.q06.test.js` (the real `enforceStorageQuota` → `quota.service` chain).

**Why A, with B's two demands:** B's case rests on a fact that is not true yet; A's rests on one that is.
