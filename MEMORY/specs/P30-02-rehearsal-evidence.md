# P28-03 / P30-02 — retirement boundary and rehearsal evidence

2026-11-25. Implementation preparation; no production cutover authorised.
Spec refs: `docs/UPSTREAM/05-DATA-MIGRATION.md` § 8, ADR-138 Am. 1 G-2,
`TASKS/PHASE-28-UPSTREAM-MOBILE-OFFLINE.md`, `TASKS/RUNBOOK-UPSTREAM-CUTOVER.md`.

- A separate nginx template retires every old application/API/APK path with 410,
  while retaining the rate-limited legacy sticker notice. No request is proxied
  to PHP. Only configured HTTPS app-origin links are rendered by the operator.
- A read-only collector requests the existing reconciliation, report-diff and
  data-quality APIs for one transformed run, validates their shared contracts,
  checks run/tenant agreement and complete check/field coverage, and records
  elapsed report durations. Output contains counts and fixed check names only.
- Manual checks, operator reconciliation review, legal basis, UAT, security
  closure, backup restore and cutover approval are never inferred from a green
  automated report. This tool neither imports data nor sends invitations.
- Verify the retirement template with real disposable nginx HTTP requests;
  verify collector behavior against independent synthetic contract responses,
  including incomplete/failed reports, redirects and sensitive values omitted.

Full rehearsal timings and production retirement remain separate operator tasks.
