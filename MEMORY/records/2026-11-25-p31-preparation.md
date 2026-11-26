# 2026-11-25 — Phase 31 archive and decommission preparation

Status: preparation implemented in the working tree, not merged. Real operational
execution remains BLOCKED on Phase 30 and the named operator evidence.
Spec: `MEMORY/specs/P31-archive-decommission-preparation.md`.
Spec refs: Phase 31; `docs/UPSTREAM/05` §§ 8, 10; `06` § 6;
`07` § 4.1; `08` §§ 5–6; `10` §§ 8–9; ADR-129 and ADR-139.

## What changed

- `scripts/upstream/archive-rehearsal.mts` creates its own isolated MariaDB container
  (`mariadb:11.8`, no published ports, `--network none`) and synthetic fixture files.
  It takes a logical dump, creates a 7-Zip AES-256 archive with encrypted filenames,
  rejects a wrong key and damaged ciphertext, decrypts to a separate directory,
  compares file/manifest bytes and restores the dump to a different database.
- `TASKS/RUNBOOK-UPSTREAM-DECOMMISSION.md` gives entry evidence, separate certificate
  evidence retention and scan/index rules, encrypted archive and retained-copy restore,
  staging +90-day retention, existing audited import-key revocation, dependency-aware
  schema/role retirement, retained static legacy host, and copy-by-copy destruction
  evidence. It contains no actual passwords, paths, domains or upstream values.
- Phase 31's cards distinguish prepared artifacts from real operational completion.

## Named evidence

`node scripts/upstream/archive-rehearsal.mts`: **PASS**, exit 0, 2026-11-25.

Checks: encrypted archive integrity; encrypted header/name refusal with a wrong
password; wrong-password integrity-check refusal; corruption refusal;
SHA-256 equality for the logical dump, synthetic binary file and evidence fixture;
exact restored manifest; actual restored SQL totals **3 rows, quantity sum 37,
minimum id 1, maximum id 3**. Generated secrets and fixture data never entered the
repository; the created container/anonymous volumes and temporary files were removed.

An initial rehearsal exposed a harness startup race: MariaDB's temporary socket
server accepted a query before the final server started. The harness now probes
and uses TCP inside the isolated container, which excludes that temporary server.
No product finding and no production data touched.

TypeScript 7 isolated strict check passed:
`node node_modules/@typescript/native/bin/tsc --ignoreConfig --noEmit --strict --types node --target ES2022 --module nodenext --moduleResolution nodenext --skipLibCheck scripts/upstream/archive-rehearsal.mts`.
`git diff --check` on the prepared files passed.

## Limits and outstanding execution

This is a small synthetic logical-restore proof, not a backup of Callibrator's
PostgreSQL target or a real upstream retained archive. It supplies no production
RTO, real restore proof, retention approval, legal hold determination, certificate
scan verdict, credential revocation, real schema drop, host retirement or secure
deletion claim. Operational archive passwords must be entered interactively and
kept separately, not passed as arguments; the harness's random password protects
synthetic fixtures only.

P31-01 still needs P30-05 plus the approved retention/custodian inventory and a
restore of the retained real archive. P31-02 needs that proof and staging sign-off
+90 days; P31-03 needs the recorded execution for every actual copy; P31-04 and
Phase 999 remain blocked. Full make verify was not run for these operational artifacts.
