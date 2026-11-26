# P31 — Archive and decommission preparation

Written 2026-11-25 before implementation.
Spec refs: Phase 31; `docs/UPSTREAM/05-DATA-MIGRATION.md` §§ 8, 10;
`06-DPIA.md` § 6; `10-OWNER-CHECKLIST.md` §§ 8–9; ADR-129, ADR-139.

## Scope

Prepare an operator runbook and a synthetic encrypted archive/restore rehearsal.
Use the existing owner-checklist option, 7-Zip AES-256 with encrypted filenames.
The operational password is entered interactively and stored separately from
the archive. The rehearsal's generated password protects synthetic fixtures only.

The rehearsal creates its own isolated MariaDB container, takes a logical dump,
archives it with synthetic files, checks wrong-password and corruption refusal,
decrypts it to a separate location, verifies every fixture byte by SHA-256, and
restores the dump into a new database. Independent SQL totals prove the restored
rows. No production endpoint, real path or upstream data is read or changed.

## Operational boundaries

Archive creation and a successful restore precede destruction. Preserve certificate
PDFs separately for their evidence retention period. The upstream archive's proposed
one-year retention is not an approved schedule. The staging schema stays until
signed reconciliation + 90 days. Legal holds override scheduled destruction.

No script deletes an upstream/local copy, drops a real schema, changes credentials,
retires a host or marks Phase 31 complete. A runbook names the required evidence
and verification for those operator actions. Phase 999 remains blocked.
