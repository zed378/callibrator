# 2026-11-25 — Remaining-work audit through Phase 31

Snapshot of task cards and their cited records during parallel continuation.
This is an implementation/evidence inventory, not a new DONE declaration.
Owner scope: continue autonomously through Phase 31; physical-device testing
excluded; dashboard redesign P11-08…14 deferred. No signature is inferred.

## Recorded implementation and active work

| Cards | Evidence and remaining engineering work |
|---|---|
| P12-01…07; P13-01; P14-01; P15-01; P16-01; P18-01…04; P19-01…08 | Their phase cards cite completed decisions, research and specs. No open coding card identified in these groups. OA facts must be read with the later owner answers, not their stale earlier BLOCKED rows. |
| P20-01…09; P21-01…10/P21-15 | Their phase cards cite built migrations, services and live evidence. This audit did not rerun those historical gates. P17's new principal/transport checks strengthen these controls without making the whole security exit green. |
| P17-07 | Active parallel work: PT-18 real broker/SMTP, PT-21 OIDC controller/session handoff, PT-17 storage exposure and PT-30 report renderer. See the specific P17 records; an in-flight run is not a pass. Existing `2026-11-25-p17-oidc-wire.md` proves synthetic IdP service roundtrip 4/4 but explicitly excludes controller cookie/handoff. Parent owns the broader exit matrix. |
| P22-01…09; P23-02…04 | Browser evidence has moved beyond the stale individual card open lists (`2026-11-25-p17-browser-security.md`, bound exports record); P22-10/P26-02 physical-phone cases remain excluded. Photo export threshold is still provisional; absence of a Web Worker is explicitly documented in `2026-10-10-p22-06-browser-exports.md` as a library-dependent limitation. |
| P27-03 | A campaign sheet was explicitly unbuilt in `2026-10-13-p27-03-sticker-layout.md`. This continuation implements a session-only sheet tray under ADR-138 Am. 6; its own record names verification and print limitations. It keeps individually authorized issuance and adds no batch token mutation. |
| P30-02 | Collector false-green fixed and retested: `2026-11-25-p30-sample-evidence-coverage.md`, 11/11 tests and real synthetic HTTP report reads. Actual-schema rollback and retained archive proofs remain the distinct rehearsals named in the P28/P30 and P31 preparation records. |

## Remaining criteria that cannot be replaced with another implementation

| Card | Missing evidence or external action |
|---|---|
| P17-01 | OA-1…03 live upstream hardening/credential/local-copy actions. Owner's 2026-10-28 answer defers these to cut-off/decommission; no new operator execution is implied. |
| P17-02/04/05 | Counsel's review remains distinct from the owner's recorded MoU decision (P17-03). Aggregate-only real EXIF survey and photo-pipeline measurements belong to P24-05. |
| P17-07 | Remaining required principal/storage/renderer cases must be mapped to named evidence after active lanes finish. Excluded phone cases are exclusions, not green results. |
| P22-06/P23-03 | Measure photo export threshold on representative largest-facility volume; D3 address/phone omission is a documented facility-read contract limitation. A synthetic measurement can give an engineering bound, not production-device proof. |
| P23-05 | Provider's side-by-side report sign-off on dry-run data. Comparison tools and browser downloads do not supply that signature. |
| P24-03/P24-05 | Real referenced photos (~91 GB) sample then full throwaway-bucket pipeline, throughput/EXIF/final-delta timing. The 2026-10-28 real database run deliberately had no image import. Synthetic pipeline success cannot close the real-volume criterion. |
| P25-01/P25-04 | R-12 actual dry-run stack journey and operator's signed reconciliation. Existing synthetic P21/P25 HTTP proof is named in `2026-11-25-p25-report-fallback-retest.md`; R-12 remains manual in the collector by design. |
| P26-02/P26-03 | Physical poor-connectivity UAT excluded by owner; UAT disposition/sign-off remains an actual human record. |
| P27-01/P27-02/P27-04 | Both QR encodings now owner-confirmed; actual legacy production host is still operator input. Notice templates and synthetic nginx checks are prepared. Physical scans excluded. |
| P28-03 | Send the retirement announcement and remove/retire APK/API at the approved real cutover. Draft and isolated nginx HTTP checks are not deployment. |
| P29-03 | Owner recording/training deliverable explicitly deferred. |
| P30-02 | Latest-data full freeze/final-delta/photo-volume rehearsal and actual target backup/restore. Synthetic timings are component measurements. |
| P30-03 | Signed reconciliation/UAT, security review disposition, invitations readiness and owner actions, then actual go/no-go. |
| P30-04/P30-05 | Production cutover and read-only dual-run window, no dual writing, post-cutover reconciliation. No target facts or calendar window are invented. |
| P31-01 | Approved retention/custodian/legal-hold inventory and restore of the retained real encrypted archive after P30-05. The synthetic archive is preparation only. |
| P31-02 | Staging sign-off +90-day retention, real audited import-key/upstream credential revocation, dependency-aware schema/role retirement and host retirement. |
| P31-03/P31-04 | Copy-by-copy secure destruction evidence and the resulting phase-exit record. No real deletion or Phase 999 unblocking is implied. |

No additional speculative cutover/decommission script was added merely to
replace missing signatures, facts or real runs. Existing preparation covers
the known operator procedures; the concrete sample-coverage defect and missing
sheet output were addressed separately. Full verify, production release and
all-cards completion remain unclaimed.
