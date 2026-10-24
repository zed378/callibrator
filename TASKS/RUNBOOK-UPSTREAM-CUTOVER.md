# Runbook — Upstream Cutover (P30-01)

> **Status: DRAFT, 2026-10-23; mechanisms P25-01/P25-02 DONE 2026-10-24.** The card's dependency (Phase 25, reconciliation) needs **real
> upstream data**, which the owner's legal decision gates (**OA-5**, UD-18). This runbook is written
> ahead of that on purpose — the same way `P29-02`'s "what changed" note was — so that the sequence,
> the commands and the rollback are reviewed **before** a freeze window exists. Every command here
> exists in the repository today. The reconciliation mechanism (P25-01: `GET …/reconciliation`) and the
> data-quality report (P25-02: `GET …/data-quality`) are built and tested on synthetic data. What is
> **not** proved: the timings against real volumes (the dry run, P24-05), and every step marked ⏳ below.
>
> **No real data value appears in this file.** Counts and structure only.

**Card:** P30-01 · **Depends on:** Phase 25 (reconciliation), P26-03 (UAT sign-off), P17-07 (security
review), P27-04 (sticker scan) · **Spec refs:** `docs/UPSTREAM/05` § 8 (the checklist this follows),
`docs/UPSTREAM/06` (DPIA), `docs/UPSTREAM/07` (minimisation), `docs/UPSTREAM/08` (file policy),
ADR-123 (images and deployment), ADR-129 (the import and transform), ADR-130 (the image import),
ADR-139 (invitations), ADR-116 (backups).

---

## 0. The One Rule

**The upstream is never written to.** Not by a migration, not by a script, not "just to check". Every
step below reads upstream; the only writes are to Callibrator and to the import's own schema. A
second system of record for the same device history diverges within a week, and the divergence is
found by an auditor.

**Rollback is the pre-import backup, not a delete.** Tenant foreign keys are `RESTRICT` (migration
0030), so "delete the imported tenants" is not a rollback path — it fails. Before cutover the target
is not in use, so restoring the backup taken immediately before the load is complete and safe; after
cutover there is no rollback for writes made in Callibrator, and the fallback is **fix forward** with
upstream read-only.

---

## 1. Roles

| Who | Does | Cannot |
|---|---|---|
| **Operator (super admin)** | every import action, the transform, the go/no-go record | decide the legal basis (that is the owner's) |
| **Platform engineer** | deploy, backup, restore, the schema checks | read a staged value into a ticket or a log |
| **The owner** | OA-5 legal, OA-4 the sticker fact, the freeze window, the go/no-go signature | — |
| **Provider administrator** | facilities, bindings, invitations, the pre-invitation gate | touch the import |
| **Counsel** | the DPA and the client-contract confirmation | — |

---

## 2. Gates That Must Be Green Before T-14 d

Nothing below starts until each row is **named in a record**, not "looks fine".

| Gate | Evidence it is green |
|---|---|
| **Legal basis and DPA** (OA-5) | the DPA is signed; the operator confirms its client contracts permit the transfer; facilities informed — recorded |
| **The pre-invitation gate** (`docs/SECURITY/15` § 11) | every "gate" row green, with the live tests named |
| **Security review** (P17-07) | no open Critical/High; each finding has its fix and its test |
| **Reconciliation** (P25-04) | the operator has **signed** zero unexplained deltas, per facility |
| **UAT** (P26-03) | signed, including the real-phone field run |
| **The sticker fact** (OA-4) | the legacy format is known, so the resolver (P27-02) is decided |
| **Backups** | `make backup` has run, and a **restore has been proved** on a throwaway (ADR-116 verifies every nightly dump; do one by hand here) |
| **Images pinned** | the release is a `<sha>` tag with digests, not `latest` (ADR-123) |

> If any row is missing, the answer is **not yet** — and that is a valid go/no-go outcome. A cutover
> started on a missing legal basis cannot be undone by a restore.

---

## 3. T-14 d — Dry Run on the Latest Dump

1. Take the **latest** dump. Note its date and size; it goes in the record (counts only).
2. Upload it: **Impor dump SQL** → choose **synthetic** or **real** honestly. With
   `UPSTREAM_REAL_DATA_ALLOWED=false` only a synthetic dump is accepted.
3. Let the job parse and stage it. **Check the counts**, not the values: rows staged per table,
   rows rejected with a reason.
4. Run the transform: **Tahap 2: transformasi** → choose the provider tenant → **Transformasi ke …**.
   It answers either the summary (per step, per source: staged / mapped / unchanged / quarantined) or
   a named failure.
5. Review the **quarantine** with the operator: `GET …/:id/data-quality` (P25-02) answers every quarantined row by source table and reason, per facility, with run-level totals — every reason, every count. A reason nobody can explain
   is a defect in the transform or in the data, not something to accept.
6. Record the **durations** per step. They are the input to the freeze estimate (§ 7).
7. Repeat until the reconciliation (P25-01: `GET …/:id/reconciliation` — R-1/R-2/R-7 per facility, R-10/R-11/RC-F1 … RC-F5 at the run level) is green and the quarantine is explained.

**Commands that help (read-only):**

```bash
make migrate-status          # what the target has applied
make migrate-verify          # the schema matches the models
make psql                    # a shell on the target database, when a count must be read
```

---

## 4. T-7 d — Bulk Files and Training

1. **Bulk photo copy.** Start the rsync image import for `foto_depan` and `foto_sn` (never the
   certificate PDFs — archive-only, `docs/UPSTREAM/07` § 4.1). Confirm the host key fingerprint **by a
   person**. It is resumable; a re-run copies only what is missing.
2. **Check the ingest's counts**: ingested, skipped as already present, quarantined by reason. Every
   file has a manifest line, so the counts reconcile per folder.
3. **Invitations drafted** — the provider administrator confirms the person behind each shared
   account. Do **not** issue yet: the gate opens after the pre-invitation checks are recorded.
4. **Training** — the guides (`docs/UPSTREAM/13-USER-GUIDES-ID.md`) and the "what changed" note
   (`11-WHAT-CHANGED-ID.md`); the train-the-trainer session is P29-03 (owner).

---

## 5. T-1 d — Announce the Window

1. Announce the **read-only window** to the facilities. Say how long (§ 7) and what staff do instead
   (record on paper, enter after).
2. Confirm the release is the **pinned** image and that `make preflight` passes on the target.
3. Re-confirm the **backup is current** and its restore has been proved.
4. Confirm the operator has the provider tenant **created** (the transform never creates a tenant)
   with its self facility, and the **import key** provisioned for the calibration records (a missing
   key fails the transform `IMPORT_KEY_MISSING` — by design, not a bug).

---

## 6. T-0 — The Cutover

Each step is a decision point. **Stop at the first surprise**; a half-run transform rolls back
everything it wrote, so stopping is safe before the invitations.

| # | Step | What proves it |
|---|---|---|
| 1 | **Freeze upstream writes** (maintenance mode) | the upstream refuses a write; recorded |
| 2 | **Final dump** | its date, size and SHA-256 recorded |
| 3 | Upload and stage it | the run reaches `loaded`; counts recorded |
| 4 | **Transform** | the summary: every step, every source, nothing unaccounted (`TRANSFORM_INCOMPLETE` would have failed it) |
| 5 | **Delta files** — re-run the rsync import | counts: only the delta is copied; the manifest is complete |
| 6 | **Reconciliation R-1 … R-11** per facility | zero unexplained deltas; the operator's signature (P25-04) |
| 7 | **Open the pre-invitation gate** for the tenant (`upstream_invitations_open`) | the operator's confirmation; the flags route writes its audit row |
| 8 | **Issue invitations** | the count of invitations sent; each account is `awaiting_invitation` until accepted |
| 9 | **Declare Callibrator the system of record** | the go/no-go record is signed (P30-03) |
| 10 | **Upstream stays read-only** | lookup only; no dual writing |

```bash
make migrate-verify          # after the release lands, before the transform
make psql                    # only when a count must be read, and counts only
```

> **What must never happen at T-0:** editing a staged row to "fix" a quarantine; re-running the
> transform after the invitations are issued (it is idempotent, but a changed upstream row after the
> freeze means the freeze did not hold); deleting an imported tenant to start over (see § 0).

---

## 7. The Freeze Window

Dominated by the delta, not the bulk — **if the bulk was loaded ahead**.

| Item | Basis | Window |
|---|---|---|
| Final dump + stage | ~384 k rows; staging measured < 1 min on a synthetic dump | minutes |
| Transform + load | ~330 k audit rows dominate; 2–10 min estimated | minutes |
| Delta files | a day's photos | minutes |
| Reconciliation | 12 checks per facility | minutes |
| **Total** | | **under 1 hour** if § 4 ran |

⏳ **Unproved:** every figure above is an estimate from the dry-run plan. P24-05 replaces them with
measurements, and P30-02 times a full rehearsal on a disposable stack before the real window is
promised to anyone.

---

## 8. T+0 … T+30 d — Dual Run

- Upstream is **read-only**, for lookup by staff who have not yet switched.
- **No dual writing.** A device's history written in two systems is two histories.
- **Post-cutover reconciliation** runs again after the first week of real use: the same R-1 … R-11
  checks, now against live data.
- Invitations still unaccepted are visible on the users page; an account still awaiting 30 days after
  its **first** invitation is deactivated by the nightly job (ADR-139 § 5). An administrator
  reactivates and re-invites.

---

## 9. Rollback

| When | Rollback |
|---|---|
| **Before the invitations** | restore the pre-import backup (`make backup` taken at § 5.3, restored by hand and verified); remove the objects under the imported tenants' `t/<tenant>/` prefixes; the upstream is still the system of record |
| **After the invitations, before any Callibrator write** | the same restore; invitations are withdrawn (the route exists, audited) and the gate closed |
| **After a Callibrator write** | **no rollback.** Fix forward: upstream stays read-only, the correction is made in Callibrator and recorded as a correction, not an edit |

A restore is not a "delete the tenants": the tenant foreign keys are `RESTRICT`, and the backup is
the only complete path.

---

## 10. T+30 d — Decommission (Phase 31, not this card)

Archive the upstream database and files encrypted for the retention period, with **one restore
tested** (P31-01); then drop `upstream_import`, revoke the import keys and the upstream credentials
(P31-02); then delete every copy, `mozivid/` on the workstations included (P31-03). `upstream_import`
is kept until the reconciliation sign-off **+ 90 days** (DPIA § 6).

---

## 11. What This Runbook Does Not Know Yet

Named, so nobody assumes otherwise:

- **The real timings.** P24-05 measures them; § 7 is an estimate.
- **Whether the freeze is one hour or four.** Depends on the link speed for the delta and on the
  transform's real cost.
- **The sticker format** (OA-4), which decides whether staff scan an old sticker into the new app or
  use the in-app lookup.
- **Whether the legal basis permits the transfer at all** (OA-5). If it does not, there is no cutover
  and this runbook is archived with the plan.
