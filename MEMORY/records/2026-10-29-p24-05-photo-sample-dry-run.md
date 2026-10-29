# P24-05: the photo pipeline on real files (a 400-photo sample) — correct, and step 9 is the slow part

**Date:** 2026-10-29 · **Card:** P24-05 (photos) · **Status:** sample DONE; finding recorded · **Follows:** the database dry runs ([record](./2026-10-28-p24-05-dry-run-real-dump.md), [catalogue fix](./2026-10-28-p24-05-fix-catalogue-symbol-limits.md))

## How it ran

[`backend/scripts/upstream-dry-run.ts`](../../backend/scripts/upstream-dry-run.ts) takes two new
optional arguments: `<uploads dir> <sample per folder>`.

- It copies an evenly spread sample of each of `foto_depan` and `foto_sn` from the local upstream
  copy into the image import's staging.
- It runs the **production ingest** (`ingestStaged`, with the dependencies the import job
  wires: ClamAV, type by magic bytes, location metadata removed, the tenant's storage).
- It records a completed image import, then the same dump's transform with that manifest.
- The tenant storage and the import workspace are redirected to a scratch directory
  (`DRY_RUN_SCRATCH`), which the script deletes at the end, whatever happened.

Not exercised: the rsync/SSH transfer (P24-07), because there is no `rsync` or `sshpass` on this
Windows host. In production it runs in the Linux container. The real photos never touched the
repository's storage. The containers, the database and the log were removed after the run.

## Results

The upstream copy holds 25,094 files in `foto_depan` and 25,008 in `foto_sn`. The sample took 200
of each.

| Stage | Result |
|---|---|
| **Ingest** (400 files, 243 s) | 393 ingested (776 MB), location metadata removed from 198, 0 failed. **7 quarantined**: `heic_converter_unavailable` 6 (ADR-132 Am. 3: the ETL converts HEIC outside the application and re-imports it) and `image_too_large` 1 |
| **Step 9** (456 s) | `foto_depan`: 186 mapped, 4 HEIC, the rest `file_missing` (not in the sample). `foto_sn`: 191 mapped, 1 too large, 1 HEIC |
| **R-8** | Run level 47,444 / 47,444 accounted. Per facility, **377 mapped photos = 377 live attachments of their purpose on their device, in their facility**, 0 failing |
| RC-F2 / RC-F3 | 0 / 0: every photo's facility and its storage key's `f/<facility>` segment agree |
| **Q-28 unreferenced** | **20** of the 400 sampled files are named by no device row (5 %; the research found 3,360 of about 50,000, 6.7 %) |
| Rest of the reconciliation | green, as in the database runs |

## Finding: step 9 dominates once real photos are in

The step took 456 s for 377 photos, about 1.2 s per photo (the read-back check, the full decode,
two derivatives, three puts). Without photos it took 54–112 s.

**Extrapolated to all ~47,000 referenced photos, it is many hours, inside the transform's one
transaction.** The cutover window cannot hold that. The design already allows the answer: a re-run
writes no photo that is unchanged (P24-03, `photoHashOf`), so the full photo pass belongs to a
transform **ahead of the freeze**, and the cutover transform then handles only the delta.

The runbook now says so. A remaining risk is a single transaction holding hours of work. Split the
photo step out, or batch it, if the rehearsal (P30-02) on the target host confirms the cost.

The ingest is about 0.6 s per file here, so a full one is roughly 8 hours on this workstation.
It runs at T-7 d in the runbook, resumable, which fits.

## Not done

- The full 50 k photo run. The sample answers correctness. Throughput belongs to the target host
  (P30-02).
- The rsync transfer on real files: on the VM or in a Linux container, with the owner's host-key
  confirmation (P24-07's flow).

## Fixed and re-measured the same day (ADR-130 Am. 1, `991b2c6`)

A benchmark on ten real photos (2.07 MB average) located the cost in `buildDerivatives`: 1,714 ms
against 5 ms to read and 2 ms to hash. The derivatives are now built at **ingest**, with the same
function and so the same bytes. Step 9 copies them.

Re-run on the **same 400-photo sample and the same dump**:

| | Before | After |
|---|---|---|
| Ingest (400 files) | 243 s (0.6 s a file) | 821 s (2.05 s a file; the decode moved here) |
| **Step 9** | **456 s** | **71.5 s**, most of it the accounting of 47,444 photo references; a run with no photo took 54–112 s |
| Step 9 per photo | ~1.2 s | ~0.05 s |
| Photos mapped / quarantined | 186 + 191 / 7 | **identical** |
| R-8, RC-F2, RC-F3, Q-28 unreferenced | 377/377, 0, 0, 20 | **identical** |
| Reconciliation failures | 0 | 0 |

The step-9 risk above is resolved: ~47,000 photos now cost minutes in the transaction, not hours.
The ingest absorbs the decode, per file and resumable. A full ingest is roughly a day of CPU on this
workstation, scheduled at T-7 d. The runbook's "photo transform ahead of the freeze" step stays as
a safeguard.
