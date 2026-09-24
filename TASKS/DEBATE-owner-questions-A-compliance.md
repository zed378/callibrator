# Debate: Owner Questions Q-09 to Q-19 (plus A-86, A-98, A-107). Position A: compliance and security first

**Position.** Callibrator stores the evidence a hospital shows an accreditor, and that a calibration
laboratory shows an ISO/IEC 17025 assessor: what was measured, by whom, whether it passed, and who
signed for it. For every open question below I argue for the answer a regulator, a hospital QA
auditor and a security reviewer would want. I also name the cost each answer puts on users and
operators, and I concede wherever the operability side is actually right.

**Ground rules I held myself to.**

- **I read the code for every question** (as of 2026-09-24, working tree). Where a document
  disagrees with the code, the code wins. Several questions turned out to hide a larger defect than
  the backlog row describes. Those are collected in § 0 because they change the answers.
- **I cite regulations by clause, and only as far as I can defend.** For KARS/SNARS and Indonesian
  regulation I name the area and not a clause number. The owner's regulatory adviser should confirm
  those before anything is written into `docs/` as a requirement.
- **I label every confidence level.** *High* means a regulator or auditor would raise it as a
  finding. *Medium* means good practice that a reasonable auditor might accept either way. *Low*
  means my preference.
- I edited no code and no other document.

---

## 0. Things found while reading that change the answers

None of these is on the backlog as stated. Each one is from reading the code. None is verified
against a live database unless I say so.

| # | Finding | Where | Bears on |
|---|---|---|---|
| F-1 | **A backup restore brings back a data subject whose record was erased under GDPR.** `anonymizeUser` rewrites `email` to `erased_<id>@erased.local` and `username` to `erased_<id8>`. The restore matches on the *original* username/email, finds nothing, and **re-creates the person** with their real name, email and phone from the archive. | `gdpr.service.js:366-380`; `tenantBackup.service.js:490-548` | Q-09 |
| F-2 | **Admin-created users are probably never marked verified.** `userCreate` writes `is_email_verified: true`. The attribute is `isEmailVerified`, and `is_email_verified` is not an attribute (unlike `role_id`, which the association declares). If Sequelize drops the key, which is the `is_deleted` trap in CLAUDE.md, every admin-created account is `isEmailVerified = false`. **Needs a psql check.** | `user.service.js:672`; `user.model.js:64` | Q-11 |
| F-3 | **An admin chooses every admin-created user's initial password, and nothing makes the user change it.** Since ADR-047 a password is a signature component, so until the user changes it the admin who set it can sign as that user. | `user.service.js:660-673`; ADR-047 | Q-11, A-98 |
| F-4 | **A second purge engine can delete every audit row of a tenant and leaves no record.** `gdpr.service#purgeExpiredData` computes `cutoff = now - (retentionDays \|\| 0)`, so a 0-day policy deletes everything up to now. It writes no audit row. Unlike `dataRetention.service`, where `<= 0` means *keep*. It has no caller today (`enforceDataRetention` is unreferenced) and nothing writes `data_retention_policies`. | `gdpr.service.js:737-835` | Q-10, Q-12 |
| F-5 | **`setRetentionPolicy` accepts `audit_logs` at any non-negative value.** One super-admin `PUT` of `1` deletes a tenant's audit trail on the next nightly run. | `dataRetention.service.js:43-58`; `dataRetention.route.js:68` | Q-12 |
| F-6 | **`audit_logs.tenant_id` is `ON DELETE CASCADE`** (W-20, known). **`calibration_records.performed_by` → `users` is also `ON DELETE CASCADE`**: hard-deleting a user hard-deletes every calibration they performed. | `auditLog.model.js:6-10`; `calibrationRecord.model.js:36-41` | Q-16 |
| F-7 | **Platform operations are written into a hospital's audit trail.** The super admin's home tenant is `DEFAULT_TENANT`, "Default Hospital Tenant" (`migration.service.js:202-213`). Under BR-A41-4, creating or deleting *any* tenant and changing *any* global role is recorded in that tenant. Its admins can read those rows, and the rows are deleted with it. | `tenant.service.js:342, 759`; `auditActor.util.js` | Q-14 |
| F-8 | **Nothing reads the impersonation claim.** `impersonatorId` goes into the access token and is never read again. `auditActor(req)` records `req.user.id`. So every mutation a super admin makes while impersonating is audited **as the hospital user**, and only the session's LOGIN row connects them. | `auth.service.js:1033`; `auditActor.util.js` | Q-17 |
| F-9 | **The `esignature` grant also lets a user read every signature in the tenant.** `/history` is gated on `esignature:read`, which `write` satisfies. It returns every `SignatureRecord` with its `ipAddress`, `userAgent` and `biometricData`, filtered by whatever `userId` the caller passes. | `eSignature.route.js:709`; `eSignature.controller.js:217-228`; `eSignature.service.js:1251` | Q-19 |
| F-10 | **The workflow creator writes the signer's name and email, not the system.** `createSignatureWorkflow` takes `signerName`, `signerEmail`, even `ipAddress`/`userAgent` from the body and never checks `signer.userId` against a user. The signature's *meaning* (`reason`) is optional. Creating a workflow uses no transaction and writes no audit row. | `eSignature.service.js:372-440, 564` | Q-19, A-86 |
| F-11 | **A deleted certificate looks forged to a third party.** `verifyByCertificateNumber` uses the default (paranoid) scope. A soft-deleted revoked certificate answers *"No certificate matches this number"* rather than *"revoked"*. | `certificatePdf.service.js:323-339` | A-107 |
| F-12 | **Changing a password writes no audit row**, and neither does the automatic lockout after five failures. Both are mutations of a principal. | `auth.service.js:644-675, 331-340` | Q-15, A-98 |

---

## Q-09: Restoring a backup: an account in the backup that is no longer in the tenant

**Recommendation: the strict alternative. Never re-create a missing account. Report it and stop.**

The restore lists these accounts as `notRestored` with the reason, and the audit row records the
list. If the admin wants that person back, they create the account through the ordinary user-create
path, and that path writes its own audit row.

**What the code does today.** `reconcileUsers` (`tenantBackup.service.js:482-566`) re-creates the
account with a **new UUID** (`RESTORE_CREATE_FIELDS` has no `id`), an unusable password, and
`isActive: false`. It already skips soft-deleted accounts (`skippedDeleted`) and refuses an account
held in another tenant (409). So "in the backup but not in the tenant" can only be an account whose
natural key disappeared: hard-deleted, or **anonymised** (F-1).

**Why.**

1. **GDPR Art. 17 and Art. 5(1)(e), and Indonesia's UU 27/2022 (PDP) to the same effect.** An
   anonymised user is exactly the row this path re-creates, with the real name, email and phone
   restored from the archive. Supervisory-authority guidance on erasure and backups is consistent:
   backups may keep erased data only if it is "put beyond use", and a restore must not bring it
   back. The S-02 default makes the restore tool the mechanism that reverses an erasure. **This
   alone decides the question for me.**
2. **21 CFR 11.100(a): a signature identity "shall not be reused by, or reassigned to, anyone
   else."** The re-created account has a new id but the old username. Old calibration records and
   audit rows point at the old id (or at `NULL`, via `SET NULL`), and the username that appears on
   printed records now belongs to a different principal. A username in the tenant would then have
   two histories that cannot be joined, and the second would inherit the first's name. That is the
   shape §11.100(a) exists to prevent.
3. **The default recovers nothing the strict answer loses.** The new UUID means no historical record
   re-links to the re-created account. The only thing it preserves is profile fields, and an admin
   can re-enter those.

**Migration / data.** No schema change. Replace the create branch with a `notRestored.push({ username, reason: "absent" })`,
and rename `pendingActivation` to `notRestored` in the response and audit row. Before anything else,
**search production for accounts a restore has already re-created**: `changes->>'operation' = 'RESTORE'`
with a non-empty `pendingActivation`, cross-checked against erasure audit rows. Any match is a GDPR
incident to assess, not a data fix.

**Cost I accept.** An admin restoring after an accidental hard delete re-invites people by hand.
Since users are paranoid (`user.model.js:132`), accidental hard deletion needs a database operator
or the unrouted `hardDeleteOffboardedTenant`, so this case is rare.

**Steelman (operability).** "A restore that doesn't restore people is a half-restore. The S-02
default is already safe because the account is inert until someone resets it and an admin activates
it." **Reply.** It is inert with respect to *login*. It is not inert with respect to *personal data*:
the erased person's details are back in the live database the moment the transaction commits,
whether anyone ever activates the account or not. The S-02 author could not have seen F-1, because
it only appears when you read the GDPR erasure code alongside the restore code.

**Confidence: High.**

---

## Q-10: Should a tenant-less (global) retention policy exist?

**Recommendation: no. Remove `data_retention_policies`, `gdpr.service#enforceDataRetention` and
`purgeExpiredData`, and keep one purge engine, `dataRetention.service`.** Platform defaults stay
where they already are, in code (`DEFAULT_RETENTION_DAYS`). A tenant override may **raise** a period
and may not lower it below a per-entity floor that the code enforces. `audit_logs` is not a purgeable
entity at all (Q-12).

**What the code does today.** There are two engines with opposite semantics (F-4). The live one
(`dataRetention.service`, scheduled nightly) reads `tenant_settings` and treats `0` as *keep forever*.
The dead one (`gdpr.service`) reads `data_retention_policies`, treats `0` as *delete everything*,
writes no audit row, and has neither a writer nor a caller. D-03 made its tenant-less branch inert.
**A global default already exists:** the environment variables behind `DEFAULT_RETENTION_DAYS`
(`AUDIT_LOG_RETENTION_DAYS=365` among them). The "global policy" question has already been answered
once, in a place nobody reviews.

**Why.**

- **ISO/IEC 17025 §8.4.2 and ISO 13485 §4.2.5** require the organisation to *define* retention and
  disposal. Two sources of truth whose semantics are inverted cannot be defined. They can only be
  described, and wrongly.
- **21 CFR 11.10(c)**: records must be protected so they can be retrieved accurately throughout the
  retention period. A retention engine that nothing runs is the "control that looks like it does
  something" the backlog row warns about. A future engineer who wires up `enforceDataRetention`
  "because it exists" deletes audit trails with no record.
- **Security:** dead code with a destructive path is attack surface and review debt. Removing it is
  cheaper than keeping it correct.

**Migration / data.** A migration that **refuses** (it does not drop) if `data_retention_policies`
has any row, and otherwise drops the table. This is the pattern of 0024 and 0026. Add a floor table
in code, for example `notifications >= 30`, `sessions >= 7`, and `audit_logs` not settable.
`setRetentionPolicy` answers 400 below the floor.

**Cost I accept.** A platform-wide default changes by deployment, not through a screen. For
something that destroys data, I count that as a benefit.

**Steelman.** "A default each tenant inherits unless it overrides is a legitimate product feature,
and a table is the obvious place for it." **Partial concession.** The *feature* is legitimate, and
it already exists in code. If the owner wants it editable at runtime, put it in **one** engine with
**one** meaning of `0`, have it write an audit row per change, and apply the floors. What I will not
accept is the current state: two engines, one of them dead but armed.

**Confidence: High** on removing the dead engine. **Medium** on floors versus a fully configurable
runtime default.

---

## Q-11: May an account that never used its activation link log in?

**Recommendation: enforce it, for new accounts, from a dated cut-over, and do it together with the
two fixes that make it meaningful.**

1. `loginUser`, `loginMfa` and the SSO exchange refuse a user with `isEmailVerified = false` with a
   `403` saying *"Activate your account from the email we sent; you can request a new link."* The
   403 comes **after** the password check, like A-83's tenant refusal, so it tells only the account
   holder.
2. **Add `POST /auth/activation/resend`**, rate-limited and answering identically whether or not the
   email exists.
3. **A completed OTP password reset sets `isEmailVerified = true`.** It proves possession of the
   mailbox exactly as the activation link does (`auth.service.js:525-565` does not do this today).
4. **Admin-created accounts get an activation link that sets the password.** The admin never chooses
   it (F-3). This is the substantive fix. Verification of the email is the mechanism.
5. **Changing a user's email resets `isEmailVerified`.** `editUser` accepts both `email` and
   `isEmailVerified` from the body today (`user.service.js:762-775`). An admin must not be able to
   assert verification.
6. SCIM- and SSO-provisioned accounts stay verified. The identity provider did the proofing.

**Why.**

- **21 CFR 11.100(b):** before an organisation assigns an electronic signature to an individual, it
  must verify that individual's identity. Since ADR-047 every account holder can sign with a password
  (Q-19). An account whose email was never proven, and whose password the admin chose, fails both
  halves: identity is not established, and the credential is not the user's alone (§11.200(a)(2):
  signatures "used only by their genuine owners").
- **§11.300(a)–(b)** and **ISO 27001 A.5.17** (authentication information): the initial secret must
  reach only the user, and the user must control it.
- **Registration creates tenant-less accounts** (`registerUser`, `auth.service.js:130-200`: no
  `tenantId`, role `USER`). Deny-by-default makes them see nothing, but they are still principals
  that can log in. Proof of mailbox is the minimum bar for a principal to exist.

**Migration / data.** Do the psql check for F-2 first:
`SELECT count(*) FILTER (WHERE NOT is_email_verified), count(*) FROM users WHERE deleted_at IS NULL;`.
Then grandfather existing active accounts with **one migration that sets `is_email_verified = true`
and writes one audit row per tenant**, `operation: "VERIFICATION_GRANDFATHERED"`, with the cut-over
date. Auditors accept a documented, dated transition. They do not accept a silent one. Enforcement
applies to accounts created after the cut-over. Seeded accounts are already `true`
(`migration.service.js:212, 989`).

**Cost I accept.** Mail has to work. An install without SMTP cannot onboard users, because the
activation link is how the password gets set. That is a hard dependency added to the product. Admins
also lose the "create a user and tell them the password over the phone" workflow.

**Steelman.** "Hospitals onboard staff in person. The admin is the identity proof, and email
verification adds a failure mode (mail) to a process that works." **Partial concession.** The admin
*is* a legitimate identity proofer under §11.100(b), since in-person proofing by the organisation is
the classic case. So what I insist on is not "the email must be proven". It is "**the admin must not
hold the user's signing credential**". If mail is unreliable, the alternative that also satisfies
Part 11 is: the admin creates the account with a one-time temporary password, and **the first login
forces a password change** before any other request succeeds (which needs A-98). Either route is
acceptable. The current state, where the admin knows the password permanently, is not.

**Confidence: High** that the admin must not hold the credential. **Medium** that email verification
specifically is the right mechanism.

---

## Q-12: May `audit_logs` be purged at all?

**Recommendation: no. Remove `audit_logs` from every purge path, and make the database enforce it.**
BR-6 in `docs/DATABASE/10-AUDIT-LOGS.md` is right. The code is wrong, and it is amended through an
ADR, not the other way round.

Concretely:

1. Delete the `audit_logs` entry from `DEFAULT_RETENTION_DAYS` and from the `purgeExpiredRecords`
   switch (`dataRetention.service.js:12, 144-153`). `setRetentionPolicy` answers 400 for it (F-5).
   The `gdpr.service` engine goes with Q-10 (F-4).
2. **Database-level append-only:** `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM <app role>`,
   plus a `BEFORE UPDATE OR DELETE` trigger that raises. `10-AUDIT-LOGS.md` already recommends the
   `REVOKE`. **Test it as the application role**, per CLAUDE.md § Evidence: as the owner, the test
   passes whether the grant exists or not.
3. `audit_logs.tenant_id` changes from `ON DELETE CASCADE` to `RESTRICT` (F-6, W-20; see Q-16).
4. **Volume is handled by partitioning, not deletion:** monthly range partitions on `created_at`.
   After the retention period *and* a signed disposal decision, a partition may be **exported to
   WORM object storage with a manifest hash, then detached**. That is a platform procedure run by a
   named operator, never a scheduled job.
5. **GDPR minimisation inside audit rows** (`ipAddress`, `userAgent`) is handled by masking, never by
   deleting the row. It keeps `userId`, `action`, `resourceType`, `resourceId` and `createdAt`, and
   the masking writes its own audit row. `maskPII` already supports `audit_logs`
   (`dataRetention.service.js:254`). It must be the *only* permitted mutation, carried out by a
   narrowly granted function (`SECURITY DEFINER`), not by the application role.

**Retention period.** **At least the life of the longest-lived record the trail covers**, where life
means how long that record must be kept after its device is retired. Pending the owner's regulatory
adviser, I would write it as: *"for the life of the tenant, and after offboarding, not less than
the longest applicable record-retention period, with 10 years as the platform floor."*

**Why.**

- **21 CFR 11.10(e)**, verbatim in substance: audit trail documentation "shall be retained for a
  period at least as long as that required for the subject electronic records." A calibration
  certificate for an infusion pump is relevant as long as the pump is in service and for the life of
  any patient-harm claim involving it. **365 days is not defensible for any regulated record on this
  platform.**
- **ISO 13485 §4.2.5:** records retained for at least the lifetime of the medical device as defined
  by the organisation, and not less than two years from release. **ISO/IEC 17025 §7.5 and §8.4**:
  technical records, *including the identity of who did what*, retained for a defined period and
  protected from tampering (§7.11.3).
- **KARS/SNARS (MFK, medical-equipment management):** surveyors ask for the inspection and
  calibration history of an item of equipment. The *who changed this record* trail is how a hospital
  shows that history was not rewritten before the survey.
- **Security:** an audit trail the application can delete is one an attacker who compromises the
  application can delete. The database grant is the only control that survives a compromised app
  role.

**Migration / data.** First find out whether the purge has already run anywhere:
`SELECT tenant_id, changes->'after'->'purged' FROM audit_logs WHERE changes->>'operation' = 'RETENTION_PURGE';`.
Rows purged before W-04 left no trace, so the honest statement for any deployment older than 365 days
is *"audit history before <date> may be incomplete"*. The ADR says so. Existing unpartitioned data
moves into a default partition. Partitioning an existing table needs a maintenance window.

**Cost I accept.** Storage grows without bound: roughly 1 KB a row, and a busy hospital writes
hundreds of thousands of rows a year, so on the order of 0.5 GB per tenant per year before indexes.
Operators gain a partition-maintenance duty and a disposal procedure. `AUDIT_LOG_RETENTION_DAYS`
disappears, and anyone who set it loses the knob.

**Steelman.** "Unbounded tables are an operational hazard, GDPR's storage-limitation principle cuts
the other way, and 365 days was a deliberate default." **Reply.** Art. 5(1)(e) permits storage for
as long as necessary, and Art. 17(3)(b) and (e) exempt data kept for a legal obligation or for legal
claims. An audit trail of regulated records is the textbook case. Minimisation is met by masking the
personal fields, not by destroying the record of who did what. The operational hazard is real, and
partitioning answers it without deleting anything.

**Confidence: High.**

---

## Q-13: Should background jobs have a first-class system actor?

**Recommendation: yes. It goes in the audit schema, not as a user row.**

- Add `audit_logs.actor_type ENUM('user','system','api_key') NOT NULL` and `actor_name VARCHAR(100)`.
- Add a `CHECK`: `actor_type = 'system'` requires `actor_name` like `'system:%'`, and `actor_type = 'api_key'`
  requires `actor_name` to hold the key's id.
- A **closed registry** in code (`SYSTEM_ACTORS = { RETENTION_PURGE: 'system:retention-purge', TENANT_LIFECYCLE: 'system:tenant-lifecycle', WORK_ORDER_SCHEDULER: …, IOT_INGEST: … }`)
  that `logAction` validates against. An unregistered system actor is refused.
- `logAction` refuses `userId: null` with `actor_type: 'user'` *at write time*.

**Why.**

- **21 CFR 11.10(e)** requires the audit trail to record operator entries and actions. For an
  automated action the "operator" is the system, and it must be *identified*, not inferred.
- **`userId: null` means three different things today:** a system job; a user later deleted (the FK
  is `ON DELETE SET NULL`, `auditLog.model.js:11-15`); and a request whose actor was simply lost.
  Nobody can tell which from the row. Three meanings in one value is an attributability defect, not
  a style issue.
- **Why not a system *user* row?** It would appear in user counts and plan limits, could be granted
  menu permissions, could be impersonated (`impersonateUser` takes any user id in a tenant), and has
  a password column that must hold *something*. A principal that can never log in should not exist in
  the table of principals that can.
- **API keys:** SCIM and other key-authenticated writes have the same "no user" problem. The column
  fixes both.

**Migration / data.** Backfill: `userId IS NOT NULL` → `'user'`; `changes->>'actor' LIKE 'system:%'`
→ `'system'` with `actor_name` copied; anything else → a fourth value, `'unknown'`, allowed **only
for rows created before the migration** (the `CHECK` compares `created_at` with the migration's
timestamp). That is honest about history rather than guessing at it. `changes.actor` stays readable
for old rows.

**Cost I accept.** An ENUM migration on the table with the most rows, and a change to every
`logAction` call site that runs outside a request (about four today). Readers of the audit log in
the frontend need a display rule.

**Steelman.** "`changes.actor` in JSON already works. It is greppable and needs no migration."
**Reply.** It works for a human reading one row. It fails for a query: *"show me every action not
taken by a person"* is a JSON predicate on an unindexed field, and nothing stops the next job from
writing `actor: "retention"` with no `system:` prefix. W-04 cannot close honestly while offboarding,
work orders and IoT ingest each invent their own string.

**Confidence: High** that there must be a first-class, validated system actor. **Medium** on columns
versus a separate `actors` table.

---

## Q-14: Which tenant records a cross-tenant change?

**Recommendation: change the default. Create a reserved PLATFORM tenant, and record under the
*affected* tenant as well.**

1. A reserved `PLATFORM` tenant, with a fixed id, a `platform` status, never offboardable, never
   listed to customers. It becomes the home tenant of platform staff, including `sys`, in place of
   "Default Hospital Tenant" (F-7).
2. **A platform-level change** (create or suspend or delete a tenant, change a global role or its
   grants, platform settings) is recorded **in PLATFORM**.
3. **A change whose effect lands inside one tenant** (that tenant's user role or override, its
   settings, its suspension, its restore, a legal hold on it) is recorded **in the affected tenant**,
   with the actor's identity. For accountability, a **second row in PLATFORM** records the same
   `resourceId`, written in the same transaction.
4. **A global role change** affects every tenant that uses the role. It is recorded once in PLATFORM,
   and tenants see it through a read-only "platform changes affecting you" view (a query on PLATFORM
   rows by `resourceType IN ('Role','RoleMenuPermission')`). Writing N rows would be a fan-out.
5. Keep BR-A41-4's fail-closed rule: if no tenant resolves, the change is refused.

**Why.**

- **Confidentiality between customers.** Today the admins of "Default Hospital Tenant" can read rows
  recording the creation, suspension and deletion of *other hospitals*, with names in `changes`. That
  is a cross-tenant disclosure produced by the audit mechanism itself, the one component that must
  never leak.
- **ISO/IEC 17025 §7.11 and 21 CFR 11.10(e) from the hospital's side:** a hospital's QA auditor must
  be able to answer *"who changed our user's permissions?"* from **their own** trail, including when
  a platform operator did it. The current rule records a change to a tenant's user under that user's
  tenant, which is right, but a tenant suspension or restore is recorded in the operator's tenant,
  where the affected hospital cannot see it.
- **Retention (Q-12, Q-16):** a platform-level record must not live in a tenant that can be offboarded.
  "Default Hospital Tenant" is an ordinary tenant row.

**Migration / data.** Create the PLATFORM tenant and move `sys` and any other platform staff into it.
Existing rows written under the default tenant with `resourceType = 'Tenant'` or a global
`Role`/`RoleMenuPermission` **are not moved**, because audit rows are append-only. Instead, one
migration audit row in PLATFORM records the cut-over and names the query that finds the old ones.
**Check before moving `sys`:** anything that treats `DEFAULT_TENANT.id` as "the super admin's tenant"
(`x-tenant-id` defaults, tests that suspend the default tenant, per the traps table).

**Cost I accept.** A new tenant row that every tenant listing must exclude. Double writes for tenant
changes made by operators. A default-tenant hospital that previously saw platform history loses it,
correctly.

**Steelman.** "BR-A41-4 is simple, it already ships, and the only affected tenant is a demo one."
**Reply.** It is a demo tenant *on the reference deployment*. On a real install, whichever hospital
was onboarded as the default is the one that receives everyone else's lifecycle events. The rule is
simple because it ignores who needs to read the row.

**Confidence: High** that platform rows must not live in a customer tenant. **Medium** on the
dual-write and view design.

---

## Q-15: Should failed sign-ins be audit rows?

**Recommendation: yes. Add `LOGIN_FAILED` and `ACCOUNT_LOCKED` to the ENUM.**

- **Known account, wrong password or MFA code:** one `LOGIN_FAILED` row in the **user's tenant**,
  `userId` = the account, `changes: { method, reason: "bad_password" | "bad_mfa" | "tenant_suspended" | "account_inactive" | "unverified" }`,
  with IP and user agent.
- **Lockout** (the fifth failure, `auth.service.js:331-340`): an `ACCOUNT_LOCKED` row in the same
  tenant, with `lockedUntil` (F-12).
- **Unknown identifier:** **aggregated rows** in the PLATFORM tenant (Q-14), one per source IP per
  5-minute window with a count and an **HMAC of the identifier**, never the raw string (people type
  passwords into the username field).
- **The write happens outside the login's transaction.** There is no committed action to roll back.
  A failed audit write is logged at `error` and does not change the 401.
- A tenant security view lists `LOGIN_FAILED` and `ACCOUNT_LOCKED` for the tenant's own users.

**Why.**

- **21 CFR 11.300(d)** is explicit. Controls must "detect and report in an immediate and urgent
  manner any attempts at their unauthorized use to the system security unit, and, as appropriate,
  to organizational management." The organisation here is the **hospital**. A winston line in the
  platform's log (which A-14 says production does not even write to stdout) cannot report anything
  to the hospital.
- **ISO 27001:2022 A.8.15 (logging)** and **OWASP ASVS (logging chapter):** all authentication
  decisions are logged, *failures above all*. Successful logins alone record everything except an
  attack.
- **Since ADR-047 a password is a signing credential.** Repeated failures against a signer's account
  are attempts on a signature.

**Migration / data.** An ENUM migration (`ALTER TYPE … ADD VALUE`, which PostgreSQL cannot do inside
a transaction block, so the migration must be written for that), an `AUDIT_ACTIONS` change, and the
existing test that asserts `AUDIT_ACTIONS` equals the model ENUM. There is no backfill: failures
before the change exist only in whatever winston kept.

**Cost I accept.** Write amplification during an attack. A password spray against known usernames
writes one row per attempt, bounded by `authPreCheck`'s rate limiting (ADR-050) and the five-attempt
lockout. This grows the table Q-12 says never shrinks.

**Steelman.** "Failures are security telemetry, not business audit. They belong in a SIEM, not in the
append-only table we keep for ten years." **Partial concession.** For **unknown identifiers**, I
agree they are telemetry, which is why I aggregate them and keep them in PLATFORM. For **known
accounts** I hold: the hospital, not the platform, is the "organizational management" that
§11.300(d) says must be told, and `audit_logs` is the only channel the hospital can read. If the
owner prefers a separate `security_events` table with its own shorter retention, that is acceptable
**provided** tenants can read their own rows. What is not acceptable is leaving them winston-only.

**Confidence: High** for known accounts. **Medium** for the aggregation design.

---

## Q-16: How should `tenant_id` foreign keys behave?

**Recommendation: `NOT NULL` everywhere. `ON DELETE RESTRICT` for regulated and evidentiary tables.
`CASCADE` only for tables that are ephemeral by definition.** The same rule applies to **user** foreign
keys on regulated tables (F-6).

| Delete action | Tables |
|---|---|
| **RESTRICT** | `audit_logs`, `certificates`, `calibration_records`, `calibration_devices`, `e_signature_records`, `signature_records`, `signature_workflows`, `signature_workflow_steps`, `attachments`, `non_conformances`, `capas`, `risks`, `sop_documents`, `sop_training_acknowledgments`, `maintenance_work_orders`, `users`, `supplier_scorecards`, `vendors`, `tenant_keys` (signature verification needs the public key), `consent_records`, `dsar_requests`, `invoices` |
| **RESTRICT** (medium confidence) | `iot_readings` (they can be calibration evidence), `stock_*`, `asset_finance`, `tenant_backups` |
| **CASCADE** | `sessions`, `notifications`, `notification_states`, `api_keys`, `webhooks`, `webhook_deliveries`, `kanban_*`, `custom_domains`, `usage_alerts`, `usage_metrics`, `plan_quotas`, `document_chunks` (derived), `batch_jobs` |
| **User FKs on regulated tables** (`performed_by`, `signed_by`, `approved_by`, …) | **RESTRICT**, never `CASCADE` or `SET NULL`. Users are paranoid, so this blocks only hard deletes, which is the intent |

`tenant_settings` is RESTRICT too. It holds the **legal hold** flag (`dataRetention.service.js:61-93`),
and a legal hold must not disappear because its tenant row did.

**Why.**

- **21 CFR 11.10(c)** (records protected throughout the retention period) and **ISO/IEC 17025
  §7.5.2/§8.4**: a record must not be destroyable as a side effect of deleting something else.
  CASCADE is exactly that. The A-88 fix direction, "use the attribute name", produces NOT NULL +
  CASCADE on a fresh database, which is **worse than today** for certificates and signatures.
- **Tenant deletion is already soft** (`tenant.model.js:124`, paranoid), so RESTRICT changes nothing
  in normal operation. It blocks exactly one path: `hardDeleteOffboardedTenant`
  (`tenantLifecycle.service.js:235-258`). That path is unrouted, has no transaction, no audit row and
  no legal-hold check, and would cascade the audit trail away (W-20). **Blocking it is the point.**
  End-of-life for regulated data must be an explicit procedure: export, a signed disposal record,
  deletion in dependency order, with the audit row recorded in PLATFORM.
- **`SET NULL` on a tenant key is a tenant-isolation defect in its own right.** A row with a NULL
  `tenant_id` matches no tenant predicate and also sits in no tenant. Only a super admin or a
  scheduler, running unscoped, sees it. That is an orphan nobody is responsible for.

**Migration / data.** One migration per table group, in the 0024/0026 pattern:

1. For each table, **refuse** if any row has `tenant_id IS NULL`, or a `tenant_id` with no tenant
   row (`LEFT JOIN tenants … WHERE t.id IS NULL`, `paranoid` rows included). Print the counts and
   ids. **Never auto-assign an orphan to a tenant**: which hospital a certificate belongs to is not
   a migration's decision.
2. `ALTER COLUMN tenant_id SET NOT NULL`, then drop and re-add the FK with the chosen action.
3. Fix the 49 associations to the attribute name **and** pass `onDelete` explicitly, so `sync()` and
   migrations converge. A test inspects `information_schema.referential_constraints` on a fresh
   database, run as the application role.

**Cost I accept.** A deployment with orphans will not migrate until someone resolves them by hand, so
upgrades can stall. Offboarding no longer frees storage, and the platform carries the data of
departed tenants for the retention period. It has to be priced into contracts.

**Steelman.** "CASCADE is the only way a tenant's data ever actually leaves, and GDPR erasure for a
departing customer requires it to leave." **Reply.** GDPR Art. 17(3)(b) exempts data kept to comply
with a legal obligation, and regulated calibration and signature records are that. Personal data
*inside* them is anonymised (as `anonymizeUser` does). The records are not destroyed. When retention
really does expire, deletion should be a deliberate, recorded act, not a side effect of `DELETE FROM tenants`.

**Confidence: High** for audit, certificate, calibration and signature tables and the user FKs.
**Medium** for the second row of the table.

---

## Q-17: How do platform-operator identities appear to tenants?

**Recommendation: three parts.**

1. **Platform operators may not author regulated technical records in a tenant.** A super admin
   creating or signing a calibration record, approving or signing a certificate, owning a CAPA, or
   authoring or approving an SOP gets `403` with *"Platform operators cannot author tenant technical
   records. Ask a tenant user with the required authorisation."* Support staff who must do this work
   are provisioned as **tenant users**, with a role and a competence record in that tenant.
2. **Operational references** (ticket assignee, backup creator, support comment author) display
   **"Platform operator · <operator code>"**, not `null`. The code is a stable pseudonym on the
   platform user (for example `OP-0007`) and resolves to a person only in PLATFORM's audit trail.
   Implement it as one explicit `skipTenantScope` include per call site, selecting only `id` and
   `operatorCode` (ADR-048 point 5 allows exactly this).
3. **Impersonation is read-only, and when it is not, it is attributed.** Refuse every mutation under
   an impersonated session except those on a short allow-list (none that touch regulated records),
   **and** carry `impersonatorId` into `auditActor` so any row written during impersonation names
   the operator (F-8). Signing and approval are always refused under impersonation.

**Why.**

- **ISO/IEC 17025 §6.2.5–6.2.6:** the laboratory authorises *its* personnel to perform specific
  activities, including reviewing and authorising results. **§7.5.1:** technical records include the
  identity of the personnel responsible for each activity. A calibration "performed by" someone
  outside the laboratory's personnel, with no competence record there, is a nonconformity whatever
  label is shown.
- **21 CFR 11.10(e) and 11.50:** a record whose author reads as `null` is unattributable. A record
  whose author reads as the impersonated hospital user is **misattributed**, and that is worse: the
  audit trail says a nurse did what a platform engineer did.
- **Confidentiality in the other direction:** hospitals have no need for platform staff's names and
  emails. A pseudonymous code is enough for the hospital to ask the platform *"who is OP-0007?"*,
  and the platform can answer from its own trail.

**Migration / data.** Report every tenant row authored by a PLATFORM-tenant user (`performed_by`,
`signed_by`, `approved_by`, `created_by` joined against users in PLATFORM). The demo seed does this
deliberately (`migration.service.js:880-881`). On production, each row is a finding for the tenant
to review. **Do not reassign it.** Add `users.operator_code` for platform users.

**Cost I accept.** Platform support can no longer "just fix" a hospital's calibration record. They
need a tenant account, or they hand the fix to the hospital. Impersonation becomes a viewing tool,
not a doing tool, and some support tickets take longer.

**Steelman.** "Operators need to fix data for customers. Showing 'Platform operator' is enough, and
blocking them means a support call becomes a two-party job." **Concession on part 2:** for operational
records a label is right, and the opposing side will likely propose the same thing. **I hold on parts
1 and 3.** A calibration laboratory's technical record authored by an outside party, or recorded
under the wrong person, is a finding an assessor writes on the first sample they pull.

**Confidence: High** on parts 1 and 3. **Medium** on the exact display.

---

## Q-18: Is a user account global or per tenant?

**Recommendation: per tenant. `UNIQUE (tenant_id, lower(email))` and `UNIQUE (tenant_id, lower(username))`.
Login is tenant-qualified. Public self-registration of tenant-less accounts ends.**

- **Tenant-qualified login.** The tenant is resolved from the host (subdomain or custom domain, which
  already exist: `tenant.subdomain`, `custom_domains`) or from a tenant code field on the sign-in page.
  `loginUser`'s `Users.findOne({ where: { [Op.or]: [{ username }, { email: username }] } })`
  (`auth.service.js:296-300`) gains `tenantId`. A missing or unknown tenant gives the same
  `401 Invalid credentials` as a wrong password.
- **Platform staff** live in PLATFORM (Q-14), so the `tenant_id IS NULL` partial index is needed only
  for the transition.
- **`registerUser`** either requires an invitation token naming a tenant or is removed. Today it
  creates principals with no tenant (`auth.service.js:170-178`).
- **`POST /users/username-check`** (`user.route.js:289`, `auth` only, no `dynamicAccess`) becomes
  tenant-local by construction.

**Why.**

- **The oracle.** Global uniqueness makes every create path answer "exists somewhere on the
  platform", and A-37 closed that on SCIM only. CLAUDE.md's traps table: *"A global uniqueness
  constraint: a cross-tenant existence oracle."* Masking the 409 (A-37 option b) hides the signal and
  keeps the harm, because a clinician still cannot be registered at a second hospital, for a reason
  the admin cannot see.
- **21 CFR 11.100(a)** requires a signature to be unique to one individual. It does not require one
  individual to have one identity. A consultant with an account at two hospitals has two signing
  identities, each authorised by the hospital that relies on it (§11.100(b)). That is *cleaner* than
  one global identity whose permissions differ by tenant.
- **Security:** the tenant boundary becomes an authentication boundary. Lockout, MFA enrolment,
  password policy and session revocation are all per hospital. With a global identity, one hospital's
  lockout policy locks the person out of the other.

**Migration / data.** Global uniqueness guarantees no collisions today, so the new composite
constraints apply cleanly. Migration order: add the composite unique indexes, deploy tenant-qualified
login, **then** drop the global ones. If the global indexes are dropped before login is qualified, an
address can exist in two tenants and `findOne` returns whichever row it happens to find, **which is an
authentication defect**. Cached lookups (`cacheKeys.userByEmail`) must gain the tenant in the key.
The password-reset lookup (`requestOTP`, `processResetPassword`: `where: { email }`) needs the same
qualification.

**Cost I accept.** Users type or bookmark a tenant URL. SSO and SCIM are unaffected, since they are
already per tenant. A person with two accounts has two passwords. This is the most user-visible
change in this paper.

**Steelman.** "A global identity with per-tenant memberships (Slack or GitHub style) is the modern
model: one login, a tenant switcher, better UX for consultants." **Honest concession:** as a *product*
model it is better, and it satisfies Part 11 if every membership has its own authorisation. But it is
a redesign of the session (which tenant is the token for?), of `auth.middleware`, of every audit row's
tenant, and of Q-14. I would not start it before Phase 6 closes. **Per-tenant accounts close the
oracle with an index change and a login change, and they do not block moving to memberships later.**

**Confidence: Medium-High.** High that global uniqueness must go. Medium on per-tenant versus
memberships.

---

## Q-19: Confirm: may every role sign?

**Recommendation: no. Default-deny, and move the "uncompletable workflow" check to workflow creation.**

1. The default `esignature:write` grant goes to roles whose function includes attesting records:
   the three admin roles, `ENGINEERING_MANAGER`, `SUPERVISOR`, `TECHNICIAN`, `HEALTHCARE_TECHNICIAN`
   and `FACILITY_MAINTENANCE`. It is **not** granted to `ROOM_USER`, `WAREHOUSE_STAFF` or `USER`. A
   tenant grants those per user or per role when it has a reason.
2. **`createSignatureWorkflow` refuses** (`409`, with an explanation) a signer who is not an active
   user of this tenant with `esignature:write`. It **derives `signerName` and `signerEmail` from the
   user row** and ignores body values, including `ipAddress` and `userAgent` (F-10). The workflow and
   its steps are created in one transaction with an audit row.
3. **The meaning of the signature is mandatory**: `reason` is one of a closed set (`authorship`,
   `review`, `approval`, `responsibility`) and becomes part of the signed payload, which it already
   is (`eSignature.service.js:564-578`).
4. **Split reading from signing.** `/history` requires `qms:read`. With only `esignature`, a user sees
   their own signatures (F-9). `biometricData` is never returned in a list.

**Why.**

- **21 CFR 11.10(g):** authority checks ensure that only authorised individuals can sign. **ISO/IEC
  17025 §6.2.6:** authorisation to review and authorise results is specific, not universal. The
  named-signer check (A-65) makes sure the *right person* signs. It says nothing about whether that
  person was *authorised to be named*. Today anyone with `qms:write` can name anyone, even a
  `ROOM_USER`, as a certificate's approver.
- **21 CFR 11.50(a):** the signed record shows the printed name, date and time, and **meaning**.
  Today the name is typed by the workflow's creator and the meaning is optional. Both are defects
  whoever is allowed to sign.
- **The migration's own rationale** was that a role left out would make workflows naming its users
  uncompletable (`0025-esignature-menu-grants.js`). Checking at creation removes that failure mode
  entirely: the workflow cannot be *created* with an unauthorised signer, so it cannot get stuck.
- **F-9 is a confidentiality defect today.** Every user of every role can list every signature in
  the tenant, with IP addresses and any biometric capture.

**Migration / data.** A migration that **removes** the `esignature` grant from `ROOM_USER`,
`WAREHOUSE_STAFF` and `USER` only where migration 0025 created it. It cannot tell a hand-set grant
from its own, so it records its own inserts. If it can't, it leaves the rows and **reports** them for
a tenant admin to review. Before the change ships: *"open workflows with a pending step whose signer
lacks the grant"*. Those are reported to the tenant, not cancelled automatically. Flush the
`permissions:*` cache (ADR-049).

**Cost I accept.** A tenant with an unusual workflow (a ward user attesting to a device handover,
say) has to grant signing explicitly. Workflow creators get a new 409 they must understand.

**Steelman.** "The named-signer check is the real control. The role grant is coarse
defence-in-depth, and default-deny just produces support tickets." **Partial concession:** the
named-signer check *is* the stronger control, and if the owner keeps the broad default, parts 2–4
still stand on their own and matter more than part 1. I would rank them **2 > 4 > 3 > 1**.

**Confidence: High** on parts 2–4. **Medium** on the default role list in part 1.

---

## A-107: May a revoked certificate, or a completed signed workflow, be deleted?

**Recommendation: no, and neither may anything else that has left `draft`.**

- **Certificates:** `deleteCertificate` allows deletion **only in `draft`**. Every other status
  answers `409` with the state and the way forward: *"This certificate is `revoked`. Revoked
  certificates are permanent records and cannot be deleted; its verification page will continue to
  show it as revoked."* Today only `signed` is refused (`certificate.service.js:577`). A
  `pending_approval` certificate is sent back to `draft` first. An `approved` one is revoked or
  withdrawn, not deleted.
- **Verification** reads with `paranoid: false`. A soft-deleted certificate, from before this fix,
  answers `found: true, valid: false, status: "withdrawn"` rather than *"no certificate matches"*
  (F-11).
- **Workflows:** `deleteWorkflow` refuses (`409`) any workflow with **at least one** signature, not
  only `completed` ones. Only a workflow with no signatures may be deleted. Otherwise it is cancelled.
- **Route `cancelWorkflow`** (`qms:write`, audit row already inside the transaction) and **route
  `revokeSignature`**. Revocation is itself a signature act: it requires re-authentication under
  ADR-047 (`verifySignerCredentials`), a mandatory reason, and either the original signer or a
  `qms` admin.

**Why.**

- **ISO/IEC 17025 §7.8.8:** when an issued report is changed, the change is identified and the
  replacement references the original. The original is not destroyed. **§7.5.2:** amendments to
  technical records keep the original. A revoked certificate is the record *that* a certificate was
  withdrawn, which is exactly what a hospital, a surveyor or a patient-harm investigator will ask
  about.
- **Third-party verification is the point of the QR code.** Someone holding a printed revoked
  certificate must be told *revoked*. *"No certificate matches this number"* reads as a forgery, or
  as the platform having lost the record. The first undermines the hospital. The second undermines
  the platform.
- **21 CFR 11.70:** signatures are linked to their records so that they "cannot be excised, copied,
  or otherwise transferred to falsify an electronic record". Soft-deleting the workflow a signature
  belongs to removes the record the signature manifests on, which excises it from every screen.

**Migration / data.** Find what has already been deleted:
`SELECT id, certificate_number, status FROM certificates WHERE deleted_at IS NOT NULL AND status <> 'draft';`
and the same for `signature_workflows` joined to `signature_records`. **Restore** (`deleted_at = NULL`)
each non-draft row, with an audit row that names this decision. The earlier delete's own audit row
stays. The reference deployment had 0 certificates on 2026-09-23, so this is likely empty there.

**Cost I accept.** Mistakes are permanent once they leave `draft`, and cleaning up test data on a
production tenant needs a revoke, not a delete. List screens need a status filter so revoked
certificates don't clutter them.

**Steelman.** "Revoked is already the terminal state. The PDF says REVOKED and the audit row
survives, so deletion is just list hygiene." **Reply.** Deletion here also changes the answer the
public verification endpoint gives (F-11), which is not a UI concern. List hygiene is a filter.

**Confidence: High.**

---

## A-86: External (email-only) signers

**Recommendation: refuse them at workflow creation. An external party who must sign is provisioned
as a tenant user.**

- `createSignatureWorkflow` answers `400` for a signer with no `userId`: *"Signers must be users of
  this organisation. To have an external party sign, invite them as a user with signing permission."*
- Add a minimal **`EXTERNAL_SIGNER` role**: `esignature:write` and nothing else, no menus beyond
  "My workflows", MFA mandatory at enrolment. Identity proofing is done by the tenant admin who
  invites them (§11.100(b)), and an account can be time-boxed.
- **Existing workflows** with an email-only step can never complete (A-65). Cancel them through
  `cancelWorkflow` with an audit row (`operation: "CANCEL", reason: "external signer unsupported (A-86)"`)
  and tell the tenant. Do not delete them (A-107).

**Why.**

- **21 CFR 11.200(a)(1):** a non-biometric e-signature uses at least two distinct identification
  components. An emailed one-time link is **one** component, possession of a mailbox. Adding "type
  your name" does not make it two. A link-plus-OTP-to-the-same-mailbox scheme is still one factor.
- **§11.100(b)–(c):** the organisation verifies the individual's identity before assigning a
  signature, and certifies to the agency that its e-signatures are the legal equivalent of
  handwritten ones. It cannot credibly certify that for an address it has never proofed.
- **Keeping one signing path** means ADR-047's re-authentication, ADR-040's cryptography and A-65's
  named-signer rule all apply without a second, weaker path that a later change could make the
  default.

**Cost I accept.** An external calibration vendor's engineer who must countersign needs an account.
That costs a seat and an invitation round trip.

**Steelman.** "DocuSign-style link signing is what every vendor expects. Forcing accounts kills the
use case." **Partial concession:** a link-based *acknowledgement* ("vendor confirms receipt") is a
legitimate feature. It must be named and stored as an acknowledgement, never rendered as a signature,
and never satisfy a workflow step. Link signing for Part 11 records needs a second factor that is not
the mailbox (an SMS OTP or a pre-registered authenticator). That is a feature needing its own ADR, not
a default.

**Confidence: High.**

---

## A-98: A Change Password menu entry for every role

**Recommendation: yes. It is not a permission. Render it for every authenticated user, and harden
the endpoint it calls.**

- The frontend shows *Change Password* (and *Profile*) to every authenticated user, whatever
  `role_menu_permissions` says. These are **self-service on the caller's own credential** and belong
  outside the permission matrix. The endpoint `POST /auth/just-update-password` is already
  `auth`-only (`auth.route.js:380`), so the backend already agrees and only the menu is wrong.
- `justUpdatePassword` writes an audit row (`UPDATE`, `resourceType: "User"`,
  `operation: "PASSWORD_CHANGED"`, no secrets) inside a transaction with the update (F-12).
- It supports **forced change on first login**. A `mustChangePassword` flag, set when an admin
  creates or resets an account, makes every request except this one answer `403 {reason: "password_change_required"}`
  (Q-11).
- SSO-only users see *"Your password is managed by <IdP>"* rather than a form they cannot complete.

**Why.**

- **21 CFR 11.300(b):** passwords are periodically checked, recalled or revised. **§11.300(d)** and
  **NIST SP 800-63B:** a user who suspects compromise must be able to change their credential
  *immediately*. An account holder with no route to rotate their own signing credential (ADR-047) is
  a Part 11 gap. Five seeded roles, including roles that can sign today (Q-19), have none.
- Credential self-service gated on an admin-editable permission can be removed by a tenant admin by
  accident. That is how the five roles lost it.

**Cost I accept.** None worth naming. One menu entry that cannot be configured away.

**Steelman.** "Some hospitals want only IT to manage passwords." **Reply.** That is an SSO deployment,
and the SSO branch above covers it. For local accounts, preventing a user from rotating their own
signing credential is not a policy any auditor will accept.

**Confidence: High.**

---

## Summary

| Question | Recommendation | Confidence |
|---|---|---|
| **Q-09** restore of an absent account | Never re-create. Report as `notRestored`. The S-02 default resurrects GDPR-erased people (F-1) | **High** |
| **Q-10** global retention policy | Remove the dead second engine and its table (F-4). One engine, code defaults, per-entity floors, `audit_logs` not configurable | High (removal) / Medium (floors) |
| **Q-11** unverified accounts | Enforce from a dated cut-over, with resend, OTP-reset-verifies, email change un-verifies, grandfathering audited. The non-negotiable part: the admin must not hold the user's credential (F-3) | High (credential) / Medium (email as mechanism) |
| **Q-12** purge `audit_logs` | Never. Remove from purges, database `REVOKE` plus trigger, `RESTRICT` FK, partition and archive, mask PII rather than delete. Floor ≥ 10 years, pending the adviser | **High** |
| **Q-13** system actor | Yes: `actor_type` + `actor_name` columns, a closed registry, honest `'unknown'` backfill. Not a user row | High / Medium (shape) |
| **Q-14** tenant of a cross-tenant change | A reserved PLATFORM tenant. Record in the affected tenant plus PLATFORM. Platform rows today land in "Default Hospital Tenant" (F-7) | High / Medium (design) |
| **Q-15** failed sign-ins | Yes: `LOGIN_FAILED` and `ACCOUNT_LOCKED` in the user's tenant. Unknown identifiers aggregated and HMAC'd in PLATFORM (§11.300(d)) | High / Medium (aggregation) |
| **Q-16** `tenant_id` FK behaviour | `NOT NULL`. `RESTRICT` on regulated tables and on user FKs of regulated records (F-6). `CASCADE` only for ephemeral tables. The migration refuses on orphans | High / Medium (second tier) |
| **Q-17** platform-operator identity | Operators may not author technical records. Operational references read "Platform operator · OP-n". Impersonation is read-only and attributed (F-8) | High / Medium (display) |
| **Q-18** global or per-tenant user | Per tenant, with tenant-qualified login. Stop tenant-less self-registration. Memberships later, if ever | Medium-High |
| **Q-19** may every role sign | No. Default-deny for `ROOM_USER`/`WAREHOUSE_STAFF`/`USER`, check the signer at creation, derive name and email from the user row, mandatory meaning, `/history` off `esignature` (F-9, F-10) | High (2–4) / Medium (role list) |
| **A-107** delete revoked cert or signed workflow | No. Delete only `draft` certificates and workflows with no signatures. Verification reads deleted rows. Route cancel and revoke, with revoke re-authenticated | **High** |
| **A-86** external signers | Refuse at creation. Provision as an `EXTERNAL_SIGNER` user with MFA. Cancel stuck workflows with an audit row. Link *acknowledgement* is a separate, non-signature feature | **High** |
| **A-98** Change Password for all roles | Yes, outside the permission matrix. Audit row on change, forced change on first login, SSO users redirected | **High** |

**Where I conceded to the operability side:** Q-10 (a runtime default is legitimate if single-engine),
Q-11 (in-person admin proofing is valid, provided the admin never holds the credential), Q-15 (unknown
identifiers are telemetry), Q-17 part 2 (a label is right for operational records), Q-18 (memberships
are the better product model long-term), Q-19 part 1 (the named-signer check is the stronger control),
A-86 (link acknowledgements are a legitimate, separate feature).

**What I would verify before any of this becomes an ADR:** F-2 in psql. Whether any `RETENTION_PURGE`
or `RESTORE` rows with a non-empty `pendingActivation` exist in production (Q-09, Q-12). Orphan
counts per table (Q-16). The owner's regulatory adviser's retention floor and the KARS/SNARS and
Permenkes references (Q-12).
