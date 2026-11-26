# Runbook — Upstream Archive and Decommission (P31)

Prepared 2026-11-25. **No production action has been executed by this runbook.**
Spec refs: Phase 31; `docs/UPSTREAM/05-DATA-MIGRATION.md` §§ 8, 10;
`06-DPIA.md` § 6; `07-DATA-MINIMISATION.md` § 4.1;
`08-FILE-POLICY.md` §§ 5–6; `10-OWNER-CHECKLIST.md` §§ 8–9;
`TASKS/RUNBOOK-UPSTREAM-CUTOVER.md` § 10; ADR-129, ADR-139.

## 1. Entry evidence

The operator records each row before changing a real system. A missing row keeps
the corresponding Phase 31 card open.

| Required evidence | Who supplies it |
|---|---|
| Completed cutover and dual-run record, including final reconciliation and sign-off | Operator, P30-04/05 |
| Signed reconciliation date; staging destruction no earlier than that date + 90 days | Operator, P25-04; DPIA § 6 |
| Approved upstream archive retention, legal holds, separate certificate-evidence retention | Controller and counsel; a proposed one year is not approval |
| Inventory of live host, database, file stores, staging, workstation copies, backups and cloud-sync copies | Operator and owners of each copy |
| Archive custodian, encrypted offline destinations, recovery key custodian, retrieval procedure | Operator |
| Old hostname retained only for the Phase 27 static notice, or explicit retirement decision | Operator |

Use opaque archive/copy identifiers in repository records. Keep actual hostnames,
paths, original filenames, data values and keys in the restricted operator inventory.
Do not combine this inventory with an archive password in a ticket or repository.

## 2. Build the archive on an encrypted operator volume

1. Stop upstream writes and record the final snapshot boundary. Copy the final
   logical upstream database dump, associated files and deployment/configuration
   needed to restore it. Configuration may contain credentials: archive it encrypted
   and revoke those credentials later. Never reuse restored credentials on a network.
2. Export `upstream_import` with the PostgreSQL owner connection **before** dropping
   it. Preserve its schema and data, including mapping, quarantine and file manifest.
   The application role cannot read staging; a successful application backup alone
   is not proof that this export exists. Record tool versions, role requirements,
   aggregate table counts and database/file SHA-256 values inside the encrypted bundle.
3. Preserve external-laboratory certificate PDFs unchanged. Under file policy §§ 5–6,
   type-check `%PDF-`, scan using updated ClamAV signatures, hash with SHA-256 and
   record active-content keyword counts. The restricted archive index is
   `(archive id, device legacy id, file sequence, size, SHA-256, active-content counts)`;
   it contains no original filename or person. Flag active PDFs for sandboxed viewing;
   never rewrite or serve them through the app. Record scan failures as unresolved;
   do not treat a scanner outage as a clean verdict.
4. Put certificate evidence and its index in a **separate encrypted archive** when
   its approved retention is longer than the general snapshot. Destroying the general
   archive must never destroy the only copy of an external laboratory certificate.
5. Use 7-Zip's existing owner-checklist AES-256 option with encrypted filenames.
   The following commands run interactively on the encrypted volume, using paths
   from the restricted inventory. `-p` prompts for the password; do not append a
   real password to an argument, shell history or script.

   ```text
   7z a -t7z -mhe=on -p <new-archive.7z> <prepared-bundle-directory>
   7z t -p <new-archive.7z>
   ```

6. Record the completed archive's SHA-256 and byte count, archive format/tool version,
   creation date, retention end, legal-hold state and custodian. Store the recovery key
   separately with restricted access. An archive and its sole key on one disk is not
   a recoverable archive. Verify the retained offline copy's hash after transfer.

## 3. Restore before destruction

1. Decrypt from the **retained offline copy** into a new encrypted disposable volume.
   Test archive integrity, then extract with an interactive password prompt:

   ```text
   7z t -p <retained-archive.7z>
   7z x -p -o<new-encrypted-restore-directory> <retained-archive.7z>
   ```

2. Compare every extracted file's SHA-256 and size with the encrypted manifest.
   Restore the upstream database into an isolated instance of the recorded compatible
   database version; expose no network port and disable outgoing network access.
   Compare independent per-table counts and selected deterministic aggregate totals
   with the snapshot record. Restore the staging dump into a separate PostgreSQL 18
   instance with its required roles; compare table counts and verify mappings/quarantine.
3. Verify the certificate index resolves the archived bytes and hashes for the retained
   evidence. Open only synthetic or explicitly selected evidence in a sandboxed viewer.
4. Record restore start/end, tool/database versions, comparisons and result, the
   verifier and archive identifier. A successful `7z t` proves archive integrity,
   **not** database restorability. Stop on any mismatch; keep every source copy.

The implementation's repeatable **synthetic** check is:

```text
node scripts/upstream/archive-rehearsal.mts
```

It needs Docker, `mariadb:11.8`, and 7-Zip (`SEVEN_ZIP` overrides its executable).
It creates its own network-isolated container and fixture directory, proves encrypted
filenames, wrong-password and corruption refusal, exact extracted file hashes and a
MariaDB logical restore (3 rows, quantity total 37), then cleans only those fixtures.
This does not substitute for the operator's retained real archive restore.

## 4. Retire access, then staging and host

Only after §§ 1–3 are complete and the staging +90-day boundary has passed:

1. Revoke each provider tenant's import key using the existing audited CLI. Use the
   actual backend container, tenant and operator from the restricted inventory:

   ```text
   docker exec <backend-container> ./backend import-key revoke --tenant <tenant-id> --user <operator>
   docker exec <backend-container> ./backend import-key status --tenant <tenant-id>
   ```

   Record that no usable reserved import key remains. Repeat per imported provider
   tenant, not only the default tenant. Never put the secret value in the record.
2. Revoke upstream database, SSH/SFTP, API/JWT and deployment credentials at their
   issuers. Confirm old credentials fail. Remove CI/deployment secret references and
   archive access no longer needed; do not rotate the live Callibrator application's
   unrelated secrets as part of this procedure.
3. With the PostgreSQL owner, inspect staging dependencies and confirm the archive
   export/restore. In a reviewed maintenance transaction drop **only**
   `upstream_import` without `CASCADE`; an unexpected dependency is a stop condition.
   Verify `information_schema.schemata` has no `upstream_import` row and the
   application can still read a synthetic device/report. Revoke and retire the
   dedicated import/transform database roles after inspecting all remaining grants
   and dependencies. Never drop a shared application/owner role.
4. Shut down the old application, APK downloads and old API routes. Keep only the
   standalone static notice if Phase 27 requires the hostname; it performs no device
   read. Retire old compute, DNS and TLS resources according to that decision.

## 5. Delete copies and write the decommission record

After archive verification, and subject to legal hold/controller retention:

- Work through **each named copy** in the restricted inventory: `mozivid/`, working
  folders, downloads, staging volumes, discarded dumps, snapshots, backup services,
  removable media, cloud-sync copies and their recycle bins/version history.
- Use the storage owner's approved deletion or cryptographic-erasure procedure.
  File deletion is not evidence of physical erasure; overwriting an SSD is not a
  reliable guarantee. Preserve the retained encrypted archive and its recovery key
  until its approved retention expires. An expiring general archive must not take
  longer-lived certificate evidence with it.
- Record the opaque copy identifier, medium, method, date, executor, verifier,
  residual backups and their expiry, plus exceptions/holds. An inaccessible cloud
  copy remains an open item; do not round it up as deleted. Never run a blanket
  Docker prune or recursive deletion over a computed real path.
- At archive retention expiry, repeat hold review, destroy the relevant archive and
  recovery keys/copies according to the approved schedule and record the outcome.

P31-04 is complete only when these real execution records exist, unresolved copies
are accounted for, and the technical lead updates the roadmap and `PROGRESS.md`.
This preparation alone does not unblock Phase 999.
