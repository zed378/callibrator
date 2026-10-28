# The owner's answers to the open owner facts and actions (OA-1 … OA-8, UD-7, UD-8, UD-18)

**Date:** 2026-10-28 · **Kind:** owner decisions · **Recorded in:** `TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md` § 3 "Owner decisions of 2026-10-28", the UD-7 / UD-8 / UD-18 rows, P17-03, P24-05

## The answers, in the owner's words, and what each changes

| # | Owner (verbatim, Indonesian) | Consequence |
|---|---|---|
| **OA-5 / UD-18** | "Saat ini hanya kontrak kesepahaman antara perusahaan kalibrator dan faskes. lanjutkan saja." | The legal basis is the memorandum of understanding between the calibration company and each facility. The owner directs the work to proceed on it. **P17-03 is closed as an owner decision**, and **P24-05, the real-data dry run, is unblocked**. Residency stays the self-hosted store, and `upstream_import` is kept until sign-off + 90 days (the 2026-10-08 working decisions) |
| **OA-6 / UD-7** | "saat ini masih terbatas di pulau jawa saja yang hanya membutuhkan UTC +7" | The operation is on Java only, all UTC+7. `Asia/Jakarta` is the source zone, which is the transform's default already. The per-table check on known events is no longer needed |
| **OA-7 / UD-8** | "tanggal kalibrasi maksudnya adalah ketika operator melakukan kalibrasi device. interval sesuai request atau standar yang diberikan sendiri oleh faskes maupun perusahaan kalibrator." | `trx_inventory.tgl_kalibrasi` is a real calibration event: the date the operator calibrated the device. The interval is set per request or standard by the facility or the calibration company, so none can be derived from upstream. Imported devices get **no `next_calibration_date`** until an interval is set. How the date is imported is a P24-02 mapping change. Today it is only kept in `source_values` |
| **OA-8** | "untuk faskes yang belum memiliki akun untuk login bisa di skip dahulu dan akan dilakukan pemberitahuan langsung ke faskes. jadi untuk undangan akan kita buatkan manual." | Facilities with no account are skipped for now. The operator tells them directly and makes their invitations by hand, through the existing invitation flow. No contact collection is needed before cutover |
| **OA-4** | "ini nanti saja, tidak perlu terburu-buru. pastikan fiturnya berjalan dahulu." | Deliberately deferred. P27-01 stays BLOCKED |
| **OA-1, OA-2, OA-3** | "setelah migrasi selesai dan tanggal cut off sudah ditentukan, upstream akan dihapus." | Upstream credential rotation, hardening and the deletion of the local copy happen at decommission (P30/P31), after the cut-off date. Until then `mozivid/` stays local and gitignored |
| **P29-03** | (training videos) | Owner deliverable, deferred |
| **P17-07** | "nanti akan dilakukan jika semua fase sudah selesai" | The two-phone exit of the security review runs after every phase |
| **Q-61** | "sepertinya bisa dilakukan nanti setelah semua implementasi selesai" | The `@callibrator` npm organisation is deferred to the end |

## What is now unblocked

- **P24-05**, the dry run of the latest real dump on a throwaway PostgreSQL 18 and bucket. After it, P25-01 and P25-02 run on real volumes, then P25-03 / P25-04 and P23-05.
- **The UD-8 mapping**: `tgl_kalibrasi` as a calibration event. This is a new P24-02 card, and its design needs an ADR because it changes ADR-133's import rules.

## Note on the legal basis

The engineering record does not judge the sufficiency of a memorandum of understanding under
UU PDP 27/2022. The DPIA (`docs/UPSTREAM/06-DPIA.md`) still names a DPA as the recommendation. This
record states that the owner chose to proceed on the MoU, as the owner is entitled to.
