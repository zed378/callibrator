# Position B: Operability, Usability and Minimal Disruption

**Hospital staff have to be able to use the product. Every deployment has to be reversible. The regulations set a
floor, and the job is to meet it with the smallest change to what people already do.**

Position paper · 2026-09-24 · answers the owner questions **Q-09 to Q-19** in
[`BACKLOG.md`](./BACKLOG.md), plus **A-107**, **A-86** and **A-98** from
[`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md). The other paper,
[`DEBATE-owner-questions-A-compliance.md`](./DEBATE-owner-questions-A-compliance.md), is being written at the same
time. I have not read it. Wherever I say what "the compliance-first view" holds, that is my own steelman of it, and
the referee should check it against A's actual text.

> **How to read this paper.** Every answer has six parts: the behaviour as the code has it today, the exact
> recommended behaviour, what it does to migrations and data, how to roll it out, the strongest argument against it
> with what I concede, and a confidence level. I say plainly where the compliance floor is. I am not arguing that
> anything should go below it. I am arguing about where above it we should stand.
>
> **Evidence standard.** Everything here was **read from code on 2026-09-24**. None of it was run against a server
> or a database. Where a claim needs `psql` or a live request to settle, I give the query or the request.

---

## §0: Four things I found while reading. The referee should weigh them before any answer.

These are **not** answers to the questions. They change the answers, and some of them are defects in their own
right. Each needs its own card, whichever position wins.

| # | Finding | Where | Why it matters to this debate |
|---|---|---|---|
| **F-1** | `signDocument` refuses any user whose `status !== "active"`, but `USER_STATUS.ACTIVE` is **`"ACTIVE"`** (upper case), which is the model default and what `userCreate` writes. As read, **every real signer gets `401 "Re-authentication required"`** before their password is checked. | `services/eSignature.service.js:547`; `constants/appConstants.js:47-51`; `models/user.model.js:59-63` | Q-19 and A-86 ask *who* may sign. Right now, possibly nobody can sign a workflow step. The A-65/A-91 tests would pass if they mock `User.findByPk` with a lower-case status. **Verify first:** log in as a seeded technician named on a pending step and call `POST /api/v1/esignature/sign`. |
| **F-2** | `userCreate` writes `is_email_verified: true`. `isEmailVerified` is the attribute and `is_email_verified` is not one, so Sequelize drops the key. This is the same trap as `is_deleted` (D-07). If that reading is right, **every account an administrator has created is stored as unverified.** | `services/user.service.js:672` | This decides Q-11. Enforcing verification would lock out every admin-created user, and none of them was ever sent an activation link. **Verify:** `SELECT count(*) FILTER (WHERE NOT is_email_verified), count(*) FROM users;` |
| **F-3** | There is a **second** code path that deletes `audit_logs`. `gdpr.service#purgeExpiredData` destroys `AuditLog` rows for any per-tenant `DataRetentionPolicy` whose `entityType` is `AuditLog` or `audit_logs`. It runs with **no transaction and writes no audit row**. W-04 fixed only the `dataRetention.service` path. | `services/gdpr.service.js:782-833` | An answer to Q-12 that edits only `dataRetention.service.js` leaves this path open. |
| **F-4** | Once a **revoked** certificate is deleted, public verification no longer reports it as revoked. `verifyByCertificateNumber` uses a plain `Certificate.findOne`, and `Certificate` is `paranoid`. A soft-deleted revoked certificate therefore answers **"No certificate matches this number."** The QR sticker on the instrument then reads as "unknown" instead of "REVOKED". | `services/certificatePdf.service.js:324-339`; `services/certificate.service.js:577` (only `signed` is refused) | This decides A-107, and it is a patient-safety argument as much as a compliance one. |

Smaller things I noticed on the way, filed here so they are not lost:

- `sendSignatureRequest` emails a hard-coded `https://app.callibrator.io/sign/${step.id}` (`eSignature.service.js:464`). That is neither this deployment's host nor, as far as I can tell, a route that exists. **Signers are not being told they have something to sign.** For usability this matters more than anything in Q-19.
- `completeWorkflow` looks up the tenant admin with `where: { role: "TENANT_ADMIN" }` (`eSignature.service.js:732`). No `role` column exists, so the lookup fails, the failure is caught as `warn`, and the "document signed" email is never sent.
- `checkUsernameAvailability` goes through the tenant-scoped hooks (`user.service.js:399`). It answers **"available"** for a username held in another tenant, and the create that follows then fails on the global constraint. The UI tells the user one thing and the database does the other. This belongs to Q-18.
- `fetchAuditLogs` returns `data.rows` and `data.meta` (`audit.service.js:153-161`). That is the envelope shape `CLAUDE.md` forbids. It also joins `user` through the tenant hooks, so every audit row whose actor is the super admin (impersonation rows included, A-82) shows a **blank actor** to the tenant. This belongs to Q-17.

---

## §1: The principle, stated once

Three facts about this product drive every answer below.

1. **The users are hospital biomedical engineers, technicians and calibration-lab staff.** They share workstations, work
   on hospital Wi-Fi, and have limited IT support. An account that stops working generates a phone call to the
   vendor, and a common response to that call is to hand out super-admin access. ADR-043 records that pattern as the
   worst outcome of a lockout. **Locking people out is not a safe default in this product. It shifts risk onto
   the most privileged account.**
2. **The reference deployment is nearly empty.** As of 2026-09-23 it had 0 certificates, 0 attachments, 0 signatures,
   0 workflows and 0 tenant keys (ADR-040, ADR-042), and it went live this month (U-01a). **Today, almost every
   data-shape decision in this paper costs nothing. After the first hospital goes live, the same decision costs a
   migration and a customer conversation.** Several of my answers are "decide now, because now it is free".
3. **Every irreversible default should lean towards keeping data.** I argue for minimal disruption in *behaviour*.
   For *data* I argue for the least destructive option: refuse, keep, report. Deleting audit rows, cascading tenant
   deletes and resurrecting erased people are the three irreversible outcomes in scope, and I oppose all three. In
   this paper the operability position and the compliance position agree more often than the titles suggest.

---

## Q-09: A backed-up account that is missing from the tenant at restore time

### What the code does

`tenantBackup.service.js#reconcileUsers` (`:480-566`):

- A backed-up user whose natural key (username or email) matches **no** row in the target tenant is **re-created**.
  The new row is `isActive: false`, `status: INACTIVE`, `isEmailVerified: false`, and its password is
  `unusableCredential()`, a value that is not a bcrypt hash and therefore matches no password. Its username is listed in
  `pendingActivation`, and the restore's audit row records it.
- A match that is **soft-deleted** is **not revived** and is counted as `skippedDeleted`.
- A live match is profile-updated in restore mode and left alone in merge mode. Its credential, role and status are
  never touched.

Two details matter. `requestOTP` and `processResetPassword` (`auth.service.js:480-566`) do **not** check `isActive`,
so the holder of a re-created account can set a real password by email OTP without waiting for an admin. And
`loginUser` refuses `!isActive` (`:321`), so the account cannot be used until an admin activates it.

### How often this actually happens

Users are soft-deleted (`paranoid` + `isDeleted`). An administrator who deletes an account by mistake therefore
leaves a soft-deleted row behind, and restore **skips** it. The re-creation branch fires only when a row was removed
outright: a hard delete, a manual SQL cleanup, or a cascade. **The case this question describes is rare. The common
case is "I deleted Budi by mistake and the restore didn't bring him back".** Under the current code that case ends in
`skippedDeleted: 1` and a confused administrator.

### Recommendation: confirm the default, and add three small things

1. **Keep S-02's default.** Re-create inactive, with an unusable credential, list the account in `pendingActivation`,
   and let the holder reset through email OTP. It never leaves a guessable credential, it never grants access without
   a human decision, and it does not lose the account.
2. **Make `skippedDeleted` actionable.** The restore response and UI should name the skipped usernames and point at
   the existing undelete path (`User.restoreStatic`, fixed under D-07) behind the users-management permission. The
   administrator's real question gets an answer, and the revival stays a separate, audited, deliberate act. That is
   exactly the property the code comment asks for (`:467-470`).
3. **Never re-create an erased person. This is the compliance floor, and I accept it outright.** GDPR Art. 17 (and
   UU PDP 27/2022, Indonesia's personal-data law, which has the same erasure right) is not met if a restore
   re-creates a data subject whose erasure was completed. **Today this is safe by accident:** D-11 records that
   `hardDeleteUser()` only soft-deletes, so an "erased" user becomes a soft-deleted row that restore skips. When D-11
   is fixed by anonymising the row (the likely fix), the backed-up email no longer matches, and **restore would
   re-create the person from the archive.** So D-11's fix must also write a keyed hash (HMAC) of the erased
   identifiers into the completed `dsar_requests` row, and `reconcileUsers` must skip, and count as
   `skippedErased`, any backed-up user whose identifier hash appears there. That is one extra lookup per restored
   user, and no schema change beyond whatever D-11 already needs.

### Migration and data

None. Item 2 is a response and UI change. Item 3 lands together with D-11.

### Rollout

Items 1 and 2 can ship any time. **Item 3 must ship in the same change as D-11, or earlier. It must never ship after
it.** Put that sequencing on D-11's card.

### The strict alternative, steelmanned

> *"Never re-create. Report only. An account that no longer exists had a reason not to exist. Re-creating it, even
> inactive, means a backup file can mint an identity, and the backup archive is caller-reachable data (D-02)."*

**What I concede:** the archive is untrusted. D-02's defence (a field allow-list, the tenant stamped server-side, a
checksum match, and no credential or privilege fields read from the file) is what makes re-creation safe, and it has
to stay exactly that narrow. If the allow-list ever grows `roleId` on *update* or `status` on *create*, this answer
flips. **Where I disagree:** "report only" loses the account in exactly the rare case restore exists for. The
inactive, unusable-credential shape means re-creation grants nothing until an administrator acts, and that is the same
human decision "report only" would require anyway, minus the retyping.

**Confidence: high** on items 1 and 2. **Medium-high** on item 3's mechanism. The HMAC ledger is my design. The
compliance side may prefer to keep erased identifiers some other way, but the rule that erased people are never
restored is non-negotiable.

---

## Q-10: Should a tenant-less (global) retention policy exist?

### What the code does

`data_retention_policies.tenantId` is nullable, and a null means "global" (`dataRetentionPolicy.model.js:19`).
Since D-03, `gdpr.service#purgeExpiredData` **skips** such a policy with a `warn` (`:808-814`). Separately,
`dataRetention.service.js` already has a platform default that **every tenant inherits**: `DEFAULT_RETENTION_DAYS`
from environment variables (`:11-15`), overridden per tenant through `tenant_settings.retention_policy_*`
(`:26-41`).

So the platform has **two** retention mechanisms. One of them, the env-var default plus the tenant override, is
already exactly the "default each tenant inherits" design the question offers as an option.

### Recommendation: no global policy rows. The environment default is the global policy.

1. **Refuse to create a `data_retention_policies` row with no tenant.** I found no service function in
   `gdpr.service.js` that creates one, so the table may be written only by seeds or SQL. Wherever the write path is,
   it gets a 400 with an explanation: *"Retention policies are per tenant. The platform default is set by
   `AUDIT_LOG_RETENTION_DAYS`, `NOTIFICATION_RETENTION_DAYS` and `SESSION_RETENTION_DAYS`."*
2. **Deactivate existing tenant-less rows rather than dropping them.** A migration sets `is_active = false` on every
   row with `tenant_id IS NULL`, logs how many it touched, and leaves the rows in place, so nobody's configuration
   disappears. An inert row that says it is inactive stops pretending to do something.
3. **Do not build inheritance into `data_retention_policies`.** It would be a third mechanism layered over the two
   that exist. Nobody has asked for it, and it is exactly the kind of parallel system that led D-03 to delete every
   tenant's audit rows.
4. Later, and not in this change: fold `data_retention_policies` and `tenant_settings.retention_policy_*` into one
   mechanism. Two stores for one fact is the G-06 shape.

### Migration and data

One small migration (`UPDATE … SET is_active = false WHERE tenant_id IS NULL`). It is idempotent and has no
blanket `catch`. It needs no `NOT NULL` constraint, which would fail on the existing rows.

### The compliance-first alternative, steelmanned

> *"A platform-level minimum retention, enforced for every tenant, is exactly what a regulated SaaS should have. A
> tenant must not be able to configure itself below the regulatory floor."*

**I agree with the goal and disagree with the mechanism.** A floor is a *validation rule* on
`setRetentionPolicy` ("no less than N days for this entity"), not a purge policy row. `setRetentionPolicy`
(`dataRetention.service.js:43-59`) currently checks only `days < 0`. Adding a per-entity minimum there is three lines
and delivers the floor with no new data model. It also fixes the rest of W-16, since the value gets validated as an
integer.

**Confidence: high.**

---

## Q-11: May an account that never used its activation link log in?

### What the code does

- `loginUser` never reads `isEmailVerified` (`auth.service.js:283-441`). Activation gates nothing.
- `registerUser` (the public endpoint) creates a user with **no tenant** and sends an activation link (`:130-218`).
- `userCreate` (an administrator creating staff) **means** to mark the account verified, but per **F-2** it probably
  does not. No activation email is sent on that path either.
- The seeded super admin is **`sys@mail.com`** (`user.service.js:28-29`), an address that cannot receive mail.
- There is no resend endpoint. Since A-59, every activation link sent before that deploy is dead.

### Recommendation: email verification is informational. Record it as an ADR and do not enforce it at login.

1. **Do not add `isEmailVerified` to `loginUser`.** In a B2B hospital product, an account is vouched for by the
   *administrator who created it*. `isActive` and `status` express that, and login already enforces both. Enforcing
   verification now would lock out every admin-created account (F-2), the seeded super admin (`sys@mail.com`), and
   every SCIM- or SSO-provisioned user, whose IdP already verified them. The super-admin case is especially bad: it is
   the Q-07 break-glass scenario, created on purpose.
2. **Fix F-2 anyway** (`isEmailVerified: true` in `userCreate`) so the column stops being wrong. The ADR can then say
   what the flag means: *"the address has been shown to reach this person"*, not *"this person may log in"*.
3. **A successful email-OTP password reset sets `isEmailVerified = true`.** `processResetPassword`
   (`auth.service.js:525-566`) already proves the user controls the mailbox, and the flag should record that. This
   costs one field on an update that already happens, and it gives Q-09's restored accounts a verified address as a
   side effect.
4. **Public self-registration is the one path where verification should gate.** A self-registered user has no tenant,
   so deny-by-default already shows them nothing. The honest answer is an owner question, not a login check: *does a
   hospital B2B product want public self-registration at all?* If not, turn it off. If so, gate *that* path on
   verification and add the resend endpoint then, not before.
5. **Do not build a resend endpoint now.** Under this answer nothing depends on verification, so resend would be a
   feature nobody needs.

### Migration and data

None for the ADR. **Before any future decision to enforce**, run the F-2 query. If every admin-created user is
unverified, enforcing needs a backfill (`UPDATE users SET is_email_verified = true WHERE <created by an admin>`), and
nothing in the schema records who created a user (A-77's audit rows now do, but only from 2026-09-24).

### The compliance-first alternative, steelmanned

> *"21 CFR 11.100(b) requires the organisation to verify the identity of an individual before establishing their
> electronic signature. An unverified email is an unverified identity, so enforce it."*

**What I concede:** §11.100(b) is real, and it applies to **signers**. **Where I disagree:** an email round-trip does
not verify an *identity*. It verifies a *mailbox*. §11.100(b) is met by the organisation, meaning the hospital admin
who creates the account for a known employee, and that is how every hospital system I know satisfies it. If the
owner wants a mechanical control, put it on *signing*, not on *login*: refuse a signature from an account that has
never proven its mailbox (item 3 gives such accounts an easy way to prove it). That puts the check where Part 11
places it, and it locks nobody out of their daily work.

**Confidence: high.** It will drop to medium if the F-2 query shows admin-created users *are* verified. My
recommendation would stay the same, but the lockout argument would be weaker.

---

## Q-12: May `audit_logs` be purged at all?

### What the code does

- `dataRetention.service.js` hard-deletes `audit_logs` older than `AUDIT_LOG_RETENTION_DAYS` (default **365**),
  nightly, per tenant, now inside one transaction with an audit row (W-04).
- `gdpr.service.js#purgeExpiredData` can **also** delete them, per tenant, with **no transaction and no audit row**
  (**F-3**).
- `setRetentionPolicy` accepts `retention_policy_audit_logs`, so any principal holding `data-retention` write can
  shorten it. Today only the super admin holds that write; tenant admins have READ.
- `docs/DATABASE/10-AUDIT-LOGS.md` BR-6 says audit logs have no delete path.

### Recommendation: no purge of audit rows, starting now. Archive later, never delete.

1. **Remove `audit_logs` from both purge maps.** Take it out of `DEFAULT_RETENTION_DAYS` in `dataRetention.service.js`
   and out of `ENTITY_MODEL` in `gdpr.service.js`. `setRetentionPolicy("audit_logs", …)` then answers 400 ("audit logs
   are not subject to retention purge"). Existing `tenant_settings.retention_policy_audit_logs` rows are ignored, and
   the purge ignores unknown keys already.
2. **Why remove rather than set a long period?** Any number in code is a guess about a regulation, made by engineers.
   It would expire silently years from now, and the purge is **irreversible**. "Keep" is the only default that can be
   corrected later. When the owner and legal counsel settle a retention period (see the floor below), it comes back
   as an explicit, audited configuration with a minimum enforced on write (the Q-10 validation rule).
3. **Growth is an engineering problem with a known answer.** It is not a reason to delete. First D-08, the missing
   indexes (`(tenant_id, created_at)` at least), which is needed whatever the owner decides. Then D-02: partition
   `audit_logs` by month when volume justifies it, so old partitions can be detached to cheap storage and exported.
   Retention by archiving costs storage. Retention by deleting costs the evidence.
4. **Amend BR-6 through an ADR** that says what is now true: no purge, archival planned, and the `REVOKE DELETE`
   grant from `10-AUDIT-LOGS.md` scheduled for later.
5. **Hold `REVOKE UPDATE, DELETE … FROM <app role>` for a separate change.** It needs a non-owner application role,
   which the deployment does not have. The test must run as that role (M-09). Done carelessly, it breaks migrations
   that run as the same role. It is the right end state, but it does not belong in this change.

### The compliance floor

21 CFR 11.10(c) and (e): audit-trail documentation is retained **at least as long as the subject electronic
records** and is available for agency review. For calibration evidence, the subject record lives as long as the
instrument's history matters, typically the device's service life plus a margin, and ISO 17025 §8.4 and hospital
accreditation (KARS/SNARS) expect that history to be producible. **365 days is almost certainly below the floor** for
any row that touches a certificate or a calibration record. I will not put a number of years in this paper, because
that is legal counsel's call. The floor is "no shorter than the records it describes", and "no purge" meets it
trivially.

### Migration and data

**No migration.** `SELECT min(created_at) FROM audit_logs;` on the VM tells us whether anything has already been
purged. The deployment went live in 2026-09, so nothing should yet be 365 days old. **This decision is free today. It
becomes irreversible for the first rows on their first birthday.**

### Rollout

A two-line code change, one ADR, and an amendment to `10-AUDIT-LOGS.md`. It changes nothing a user can see. Ship it
first, before anything else in this paper.

### Steelman of the opposite

> *"GDPR storage limitation (Art. 5(1)(e)) says personal data must not be kept longer than necessary. Audit rows hold
> IP addresses, user agents and names in `changes`. Keeping them forever is its own violation."*

**Conceded in part.** The answer is minimisation, not deletion. `dataRetention.service#maskPII` already maps
`audit_logs → ipAddress, userAgent` (`:252-255`). Redacting IP and user agent after a period, while keeping who did
what to which record and when, satisfies storage limitation for the personal data while keeping the evidence. Art.
17(3)(b) and (e) exempt data needed for legal obligations and legal claims, which is exactly what a regulated audit
trail is. So a masking job that anonymises those two columns (not deletes) after N days is a good follow-up, and I
would support it.

**Confidence: high.** I expect Position A to agree on "no purge" and to want the `REVOKE` sooner. On sequencing, the
`REVOKE` is where we would differ.

---

## Q-13: Should background jobs have a first-class system actor?

### What the code does

The purge writes `userId: null` and `changes.actor: "system:retention-purge"` (`dataRetention.service.js:8,
184-199`). `audit_logs.userId` is a nullable foreign key to `users` (`auditLog.model.js:34-41`). `tenantId` is NOT
NULL.

### Recommendation: a closed list of system actors, and no system user row

1. A frozen constant, `constants/systemActors.js`: `RETENTION_PURGE`, `TENANT_LIFECYCLE`, `CALIBRATION_SCAN`,
   `IOT_INGEST`, `SESSION_CLEANUP`.
2. `logAction` takes an optional `systemActor` and enforces **exactly one of** `userId` or a known `systemActor`.
   With both null, or an unknown actor, it refuses, re-throwing inside a transaction as A-42 does. When `systemActor`
   is used, it writes `userId: null` and `changes.actor`. This gives the same validation shape as `AUDIT_ACTIONS`.
3. **No schema change.** An `actor_type` column can come with D-02's partitioning, when the table is rewritten
   anyway.

**Why not a system user row?** `audit_logs.tenantId` is NOT NULL and user rows are tenant-scoped. A real "system"
user would need **one row per tenant**, seeded into every existing and every new tenant. It would appear in user lists
(like `sys`, which `fetchUsers` hides by name, `user.service.js:219-227`), count against `maxUsers`, and be one
mis-set password away from being a login. And per ADR-048, a single global system user would read as `null` through
every tenant-scoped include anyway. A string in a closed list is less machinery and shows up just as clearly in
review.

**What each job records:**

| Job | Audit row | Why |
|---|---|---|
| retention purge | one per tenant per run (already built) | it destroys records |
| tenant lifecycle / offboard | one per transition (W-01 built it with `changes.actor`) | it changes tenant state |
| calibration scan | one per **work order created** | a record a technician acts on. Low volume |
| session cleanup | **none** | it deletes expired sessions, which are not records under Part 11. The sweep is idempotent |
| IoT ingest | **none per reading.** Audit provisioning, token changes and tolerance changes, which are human acts | readings are instrument data, not operator actions. One audit row per reading would multiply the largest table by the second largest |

### The compliance-first alternative, steelmanned

> *"Every mutation writes an audit row" is a non-negotiable in `CLAUDE.md`, and IoT ingest is a mutation.*

**What I concede:** that is what the rule says. **What I argue back:** Part 11's audit trail (§11.10(e)) covers
*operator entries and actions* that create, modify or delete records. The integrity of automatically captured
instrument data comes from the reading itself: its timestamp, its device, and the fact that it is never updated. If
the owner wants ingest audited, audit it **per batch or per device-hour**, not per reading. Otherwise `audit_logs`
growth becomes a function of sensor frequency, which undermines Q-12's "keep everything".

**Confidence: high** on the constant. **Medium** on the IoT exclusion. That is a real interpretive call, and it should
be made in the ADR by name.

---

## Q-14: Which tenant records a cross-tenant change?

### What the code does

BR-A41-4, as the A-41 spec wrote it. A change to a global role is recorded under the actor's home tenant. A change to
a user's role or permission override is recorded under that user's tenant, falling back to the actor's. If neither
resolves, the change is refused (NOT NULL fails and the transaction rolls back). `user.service.js:104` applies the
same fallback.

### Recommendation: confirm it as written

Roles are global (D-16), and every role mutation is `rbac(["SUPERADMIN"])`, so in practice **every global-role change
is a platform-operator act**, recorded in the platform's own tenant. That is where it belongs: tenant auditors cannot
change roles, and the platform operator is who answers for the change. User-level changes land in the affected user's
tenant, where that tenant's auditor looks. Keep the fail-closed refusal.

**One addition, and no more:** state in the ADR that tenants **cannot see** global role changes that affect them. If
a hospital's auditor asks "who changed what TECHNICIAN may do?", the answer is in the platform tenant's trail, and the
platform provides it on request. Fanning one row out into every tenant would multiply rows by the tenant count for no
change in who can act. Do not build it.

### Steelman

> *"A hospital must be able to see every change that affected its users' access, in its own trail."*

That is a fair want. It becomes a real requirement when roles become per-tenant (D-16 / A-38), and then the question
disappears, because a tenant's role change is recorded in that tenant. Until then, "the platform provides it on
request" is the honest answer.

**Confidence: high.**

---

## Q-15: Should failed sign-ins be audit rows?

### What the code does

A wrong password increments `failedLoginAttempts`, and the fifth sets `lockedUntil` for 15 minutes
(`auth.service.js:330-342`). Failures are logged at `warn` (A-67). No audit row is written, and the ENUM has no
`LOGIN_FAILED`.

### Recommendation: audit the lockout, not every failure. No ENUM migration.

1. **When an account locks, write one audit row inside the same transaction as the `lockedUntil` update:**
   `action: "UPDATE"`, `resourceType: "User"`, `changes.operation: "LOCKOUT"`, with the failure count, IP and user
   agent. It *is* an update to the user row, so it fits the house pattern ("the nearest action, with
   `changes.operation` naming it"), and **needs no ENUM change**. It is bounded: at most one row per account per 15
   minutes, whatever an attacker does.
2. **Failed re-authentication at signing**, meaning a wrong password on `approve`, `sign`, `revoke` or a workflow
   step, is the Part 11-relevant failure ("someone tried to sign as you"). Record it the same way, on the resource
   they tried to sign, with `operation: "SIGN_REAUTH_FAILED"`. It stays low-volume, because only an authenticated user
   can reach it.
3. **Individual failed logins** stay in the security log (winston, `warn`, with a real retention period, which A-14
   still has to make durable). Unknown usernames have no tenant and belong there anyway.
4. Alerting (§11.300(d): "detect and report in an immediate and urgent manner") belongs to M-08 / P7-02 (job and
   event alerting). It does not belong in the audit table.

**Why not a row per failure?** Credential stuffing would then write permanent rows at the attacker's rate, into a
table with no indexes (D-08) that, under Q-12, we have just decided never to delete from. That lets an attacker grow
the evidence table without limit.

### Steelman

> *"An auditor asks 'show me every failed attempt against account X'. Aggregates are not evidence."*

**What I concede:** that request is plausible. The security log answers it for its retention period, and the lockout
rows answer it permanently at the granularity that matters. If the owner insists on per-failure rows, then add
`LOGIN_FAILED` (on PostgreSQL 12+ `ALTER TYPE … ADD VALUE` is cheap and non-blocking), **known accounts only**, and
**put a rate cap per account** on the audit write. The ENUM change is not the risk. Unbounded growth is.

**Confidence: medium-high.**

---

## Q-16: How should `tenant_id` foreign keys behave? (A-88)

### What the code does

Associations declare `foreignKey: "tenant_id"`, the column name, instead of the attribute. On a `sync()`-built
database that gives a second, **nullable** attribute with `ON DELETE SET NULL` (A-88). Some models also declare
their own `tenantId` with `onDelete: "CASCADE"`: `users` (`user.model.js:32-37`) and `audit_logs`
(`auditLog.model.js:6-10`, and W-20 confirmed `audit_logs.tenant_id ON DELETE CASCADE` in psql). So today a hard
delete of a tenant row would **delete every audit row and every user** and orphan the rest. The only code that hard
deletes a tenant, `hardDeleteOffboardedTenant`, is **not routed** (W-20).

### Recommendation: `RESTRICT` by default, `CASCADE` only on a short reviewed allow-list, and one converging migration

1. **Default `ON DELETE RESTRICT`** on every `tenant_id` FK. A tenant that still holds data cannot be hard-deleted,
   and the database says so with an error. Tenants are soft-deleted in normal operation (`paranoid`), so **no user
   flow changes.** This is the minimal-disruption option *and* the compliance option. The two positions should not
   disagree here.
2. **`CASCADE` only for derived or ephemeral tables**, named in one constant (`TENANT_FK_CASCADE_ALLOWLIST`): `sessions`,
   `notifications`, `notification_states`, `"UsageMetrics"`, `usage_alerts`, `document_chunks` (a derived AI index),
   `webhook_deliveries`, `batch_jobs`. Everything else is `RESTRICT`: certificates, calibration records, both
   signature tables, workflows and steps, attachments, devices, work orders, NC/CAPA, SOPs and acknowledgements,
   risks, stock movements, invoices and subscriptions (tax records), users, and **audit_logs**.
3. **`audit_logs` gets `RESTRICT` too** (W-20). Dropping the FK and keeping the tenant id as a plain value is the other
   defensible option. I prefer `RESTRICT` because it also stops rows being written with a tenant id that names
   nothing. Either way, the cascade goes.
4. **Fix the associations** to `foreignKey: "tenantId"` with an explicit `onDelete` that matches the migration, so a
   fresh `sync()` database and a migrated one end up identical.
5. **Add a data-driven test** over every association to `Tenant`: it uses the attribute name, and its `onDelete` is
   `RESTRICT` unless the target is on the allow-list. This follows the same pattern as the A-87 and W-01 tests.

### The migration, made safe

Follow the house pattern from `0024`/`0026`: **refuse, don't repair.**

1. For every table with a tenant FK: `SELECT count(*) WHERE tenant_id IS NULL`. **If any regulated table has
   orphans, refuse to run and name the table and the count.** Orphans belong to nobody and are invisible to every
   scoped read. Assigning or deleting them is a human decision.
2. Drop every FK constraint on `tenant_id` whatever its name (there may be duplicates from the double attribute), and
   add the one with the chosen `ON DELETE`.
3. `SET NOT NULL` where the model says NOT NULL. **Exception:** `users.tenant_id` stays nullable for the super admin.
4. No blanket `try/catch`. Verify with `\d <table>` in psql after `make migrate` (the migration log is not evidence).

**A trap to name before anyone falls into it.** Removing the association's `tenant_id` attribute removes a
*writable* attribute. Any code that writes `tenant_id:` into those models, instead of `tenantId:`, will silently stop
writing. That is the same shape as F-2 and D-07. `userCreate` already writes `role_id:` and relies on the `User →
Role` association having created that attribute (`user.model.js:205-209`). **Before changing any association, grep for
snake_case keys written into the affected models**, and let the data-driven test also assert that no service writes a
non-attribute key. Otherwise this migration trades a nullable column for a silent write drop.

### Data consequences

On the reference deployment (no tenant ever hard-deleted, and near-empty regulated tables) I expect zero orphans, so
the migration is a constraint rewrite. **Run it before the first hospital goes live**, while it is free.

### Rollout

One migration, one model sweep, one test, one ADR. The migration runs at boot. If it refuses, the backend refuses to
start, as with `0024` and `0026`, so it goes out **as a planned deploy with the orphan query run by hand the day
before**, not in a routine rebuild.

### Steelman

> *"Decide per table, as the question asks. A blanket RESTRICT will one day block a legitimate offboarding."*

**That is correct, and it is intended.** The legitimate offboarding (a contract ends and the retention period
passes) must be an explicit, ordered, audited procedure: export, archive, then delete in dependency order inside a
transaction with a platform audit row. That is W-20's fix direction. `RESTRICT` guarantees nobody can skip that
procedure by deleting one tenant row. The per-table decision *is* made. It is just made once, as "regulated =
RESTRICT", instead of 39 times.

**Confidence: high.**

---

## Q-17: How do platform-operator identities appear to tenants? (ADR-048)

### What the code does

Since A-87, a reference to the super admin (whose user row is outside the tenant) comes back as `null` through every
tenant-scoped include. The places this shows up are the tenant's **audit log list** (the actor column goes blank on
impersonation rows, A-82), ticket assignee, calibration performer, stock adjuster, SOP author and backup creator
(A-90).

### Recommendation: a label for operational references, and no operator authorship of regulated evidence

1. **Label.** A small presenter, `presentActor(id, included)`. When the foreign-key id is set but the include came
   back null, and the id is in the set of platform-operator ids (a cached list of users holding the SUPERADMIN role,
   read with an explicit, commented `skipTenantScope`), it returns
   `{ id, displayName: "Platform operator (Callibrator support)", isPlatformOperator: true }`. Tenants never see the
   operator's name or email: they are the vendor's staff data, and ADR-048's isolation holds. Apply it first to the
   audit log list, where a blank actor on an impersonation row does real damage to trust. After that, apply it to
   tickets, backups, stock and SOPs.
2. **The super admin does not author regulated evidence inside a tenant.** Creating a calibration record, approving or
   signing a certificate, and signing a workflow step are refused for a principal with no tenant membership (403, a
   permission failure in the caller's own context). The first place they show up is `dynamicAccess`'s super-admin
   bypass on those specific write routes. Part 11 §11.50 requires a signature manifestation to carry the signer's
   **printed name**, and a record signed by "Platform operator" fails that. **Impersonation is not the workaround:**
   it records the *target* user as the author of an act the operator performed. The audit row names the operator
   (A-82), but the calibration record itself does not. If the platform needs to fix tenant evidence, the tenant does
   it, or a correction procedure does (P6-03 / Q-01).
3. **Do not build a "narrow opt-out" from ADR-048 for includes.** Every opt-out is a place where tenant isolation is
   off. The label gets the usability benefit without it.

### Migration and data

None. The reference deployment has no operator-authored regulated rows (0 certificates, 0 signatures). Check
calibration records with
`SELECT count(*) FROM calibration_records cr JOIN users u ON u.id = cr.performed_by WHERE u.tenant_id IS DISTINCT FROM cr.tenant_id;`

### Steelman

> *"The label hides who did it. Part 11 wants the individual."*

**What I concede:** a tenant auditor cannot name the individual from the label. The platform can: the audit row
carries the operator's real `userId`, and the platform resolves it on request. That meets attribution, because the
record *is* attributable, just not *disclosed* to the tenant. For signatures, where Part 11 does require the name
*on the record*, item 2 removes the case altogether.

**Confidence: medium-high.** Item 2 changes super-admin behaviour, and the owner should confirm that no support
workflow depends on operators creating calibration records in customer tenants.

---

## Q-18: Is a user account global or per tenant? (A-37, D-06)

### What the code does

`users.email` and `users.username` are globally unique (`user.model.js:156-157`). Login looks the user up by username
**or** email with no tenant (`auth.service.js:296-313`), and so do password reset (`:483`, `:536`), SSO provisioning
and SCIM. The duplicate checks in front of creation are tenant-scoped, so a collision with another tenant surfaces from
the constraint. A-37 hid that signal on SCIM only.

### Recommendation: keep global identity now. Move to "global identity with tenant memberships" later, not "per-tenant uniqueness".

**Per-tenant uniqueness is the wrong fix for this product, and here is the operational bill.** Login becomes
ambiguous, so every user in every hospital needs a tenant selector or a tenant-qualified login (a hospital code or a
subdomain). Hospital staff on shared workstations will then log into the wrong tenant, or forget the code. Password
reset by email becomes ambiguous, and so does SSO account linking. **And for the case D-06 cites as the benefit**, a
clinician consulting at two hospitals, it gives that person *two* accounts, two passwords and two MFA enrolments.
That is worse for them and worse for attribution: one human, two identities.

The model that serves that clinician and closes the oracle is **one global identity with memberships in several
tenants**, joined by **invitation**. The admin enters an email address and the answer is always *"Invitation sent"*,
whether or not an account exists. The invitee accepts from their inbox. That leaks nothing, because the response is
identical, and it needs no login ambiguity, because the identity stays global and a tenant switcher appears only for
people with more than one membership. **It is a feature, though, and nobody has asked for it yet.** Build it when the
first multi-hospital user is a real customer request.

**Until then (now):**

1. Keep the global unique constraints.
2. Every create path (admin `userCreate`, public `registerUser`, SCIM) answers a collision the same way whether it is
   in-tenant or cross-tenant: 409, *"This email address or username is already in use. If the person already has a
   Callibrator account, contact support."* No constraint text and no 500. That extends A-37's treatment from SCIM to
   the other two paths.
3. Fix `checkUsernameAvailability` so it checks **globally** (with an explicit, commented `skipTenantScope`) and gives
   the same "in use" answer. It currently says "available" and then the create fails.
4. Log cross-tenant collisions at `warn` with the actor, so abuse is detectable.

### The residual, stated honestly

An administrator with `users:write` can still tell "exists somewhere on the platform" from "free" by attempting a
create. I accept that as a **documented, low-severity disclosure to a privileged, authenticated, in-tenant actor.** It
reveals that an address uses the platform. It does not reveal which hospital holds it, and it reveals no records. The
invitation model removes it later. The public `registerUser` path is the worse oracle, because it is unauthenticated,
and item 2 closes it now.

### Steelman

> *"`CLAUDE.md` lists a global uniqueness constraint as a cross-tenant existence oracle in its traps table. You are
> keeping one."*

**Conceded:** I am keeping a known oracle, with a narrowed signal, as a deliberate and recorded trade. The alternative
changes how every user in the product logs in, to close a disclosure that needs admin privileges to reach. If the
referee weighs the oracle higher, my fallback is still not per-tenant uniqueness. It is to **build the invitation
model now**, because that closes the oracle *without* the login ambiguity.

**Confidence: medium.** It is the most contested answer in this paper, and it depends on how the owner reads the
product roadmap (group hospitals, consultants, calibration labs serving many hospitals).

---

## Q-19: May every role sign? (A-84, ADR-049)

### What the code does

Every seeded role holds `esignature: write` (`roleConstants.js:213, 252, 295, …`). `signDocument` refuses anyone but
the named signer (A-65) and re-authenticates by password or MFA (ADR-047). A tenant can withdraw the grant per role or
per user.

### Recommendation: confirm the default, and move the check to workflow creation

1. **Keep "every role may sign".** The grant is not what authorises a signature. Being **named** by someone with
   workflow-management rights (`qms`/`workflows` write) is. Withholding the grant from a role only makes workflows that
   name its users impossible to complete (A-91 is the evidence: a technician who could not open their own step).
2. **Refuse an unsignable signer when the workflow is created, not when it gets stuck.**
   `createSignatureWorkflow` (`eSignature.service.js:372-448`) checks that every named `userId` is an active user in
   the tenant who holds `esignature: write`. Otherwise it returns 400 naming the signer: *"<name> cannot sign: their
   role does not permit signing in this organisation."* A workflow that cannot complete then never exists.
3. **Fix F-1 first.** If `status !== "active"` refuses every signer, then which roles may sign is academic.
4. **Fix the signature-request email** (the hard-coded `app.callibrator.io` link) so it points at the deployment's
   frontend "To sign" tab (A-91). A signer who is never told is a stuck workflow too.

### Steelman

> *"Least privilege. A ROOM USER or WAREHOUSE STAFF should not hold signing authority over calibration evidence. ISO
> 17025 §6.2.6 requires the lab to authorise personnel for specific activities, including reviewing and reporting
> results."*

**What I concede:** authorisation of personnel is real, and it has to live somewhere. **Where I place it:** in who is
*named* on a workflow and in who may *approve or sign certificates* (their own routes and slugs). The
`esignature: write` grant only says a person may complete a step that someone has already asked them to sign. If a
laboratory wants "only these people may ever be named", that is a per-user **signing authority** flag checked by
item 2, and it can be added when a lab asks. It is one boolean and a line in the creation check, and nothing needs
redesigning.

**Confidence: high.**

---

## A-107: May a revoked certificate, or a completed signed workflow, be deleted?

### What the code does

- `deleteCertificate` refuses only `signed` (`certificate.service.js:577-579`). **`approved`** (which carries an
  approval `ESignatureRecord`) and **`revoked`** are deletable (soft delete, audited).
- A soft-deleted certificate disappears from public verification (**F-4**).
- `deleteWorkflow` soft-deletes any workflow, **including `completed`** (A-113). Verification survives, because
  `verifySignature` reads the workflow with `paranoid: false` (`:813-815`), but the workflow drops out of every list.
- `cancelWorkflow` and `revokeSignature` have service functions and **no routes**.

### Recommendation

| Object and state | Delete? | Behaviour |
|---|---|---|
| Certificate `draft` | yes | soft delete, audited (unchanged) |
| Certificate `pending_approval` | yes | unchanged. Withdrawing a submission is ordinary work |
| Certificate `approved` | **no** | 409: *"This certificate is approved and carries an approval signature. Sign it or revoke it."* |
| Certificate `signed` | no | unchanged (409, revoke instead) |
| Certificate `revoked` | **no** | 409: *"Revocation is final and must stay verifiable: a printed copy or QR code in circulation must keep reporting 'revoked'. Hide it from your list with a filter instead."* |
| Workflow with **no** signatures (pending, not yet signed) | yes | soft delete, audited (unchanged) |
| Workflow `cancelled` | yes | it records no completed act |
| Workflow `completed`, or any workflow with at least one signature | **no** | 409 with a state explanation. Cancel it instead if it is still open |

**Why this is the usability answer, not only the compliance one.** The only reason an administrator wants to delete a
revoked certificate is list clutter. The fix for clutter is a **default list filter** (hide `revoked` unless asked),
not destroying the evidence the QR sticker points at. A biomedical engineer who scans a sticker and sees
*"No certificate matches"* has been told something false and dangerous. The truth is "this calibration was revoked,
do not rely on it".

**Routes:**

- **Route `cancelWorkflow` now:** `POST /esignature/workflows/:id/cancel`, gated on `workflows` write (management),
  audited (the service is already transactional, A-104). Without it, a workflow whose signer has left the hospital can
  only be *deleted*, which is exactly the path we are closing. This is the one new route users need.
- **Do not route `revokeSignature` yet.** Nobody has asked for it. The practical need, "this certified result is
  wrong", is met by certificate revocation, and a mistake in an open workflow is met by cancel. If it is routed later,
  revoking a signature is itself a signature-grade act, so it needs re-authentication (ADR-047) and a reason. Record
  that on A-107 so the handler is not wired up casually.

**Migration and data:** none. 0 certificates and 0 workflows on the reference deployment.

**Steelman (the other direction):** *"An admin needs to remove a certificate created in error even after approval."*
**Answer:** revoke it. Revocation exists, is audited and re-authenticated, and tells the truth to anyone holding a copy.
There is no case where deleting beats revoking once a signature exists.

**Confidence: high.**

---

## A-86: External (email-only) signers

### What the code does

A workflow step can carry `signerEmail` with `signerId: null` (`eSignature.service.js:402-417`). Since A-65 nobody can
sign such a step (`:520`), so the workflow can never complete.

### Recommendation: refuse external signers at creation, and do not build external signing now

1. `createSignatureWorkflow` requires every signer to carry a `userId` resolving to an active user in the tenant (with
   Q-19's item 2). An email-only signer gets 400: *"External signers are not supported. Add the person as a user
   (the basic USER role can sign) and name them."* `signerEmail` stays as the notification address.
2. **Existing data:** a one-off report of workflows with a `signerId IS NULL` step that is still pending. On the
   reference deployment the expected count is 0. Any that exist get cancelled through the new cancel route.

**Why not build the emailed one-time link?** Part 11 §11.100(b) and §11.300 require the organisation to verify an
individual's identity **before** establishing their electronic signature, and to control the uniqueness of that
identity. For an outsider, identified only by an email address that the workflow creator typed, none of that exists.
A magic link proves control of a mailbox at one moment. Building a real external-signer identity (enrolment,
verification, re-authentication at signing, printed name on the manifestation) is a sizeable feature. **Nobody has
asked for it.** The realistic external party, a calibration laboratory, is already modelled as its *own tenant*
(`CALIBRATOR ADMIN`), and cross-tenant signing is a different design question entirely.

**Steelman:** *"Hospitals do need a vendor's engineer to sign a service report."* When that comes as a real request,
the cheapest compliant answer is still an account, meaning a USER in the hospital's tenant with signing only, created
by the hospital admin, who vouches for identity (see Q-11). That works today with zero new code.

**Confidence: high.**

---

## A-98: A Change Password menu entry for every role

### What the code does

`change-password` is a child of `account` (`seedMenuGroups.util.js:131-155`, beside `profile-page` and
`notifications`). Five roles hold no `account` grant: TECHNICIAN, HEALTHCARE TECHNICIAN, FACILITY MAINTENANCE,
WAREHOUSE STAFF and ROOM USER (`roleConstants.js:365-433`). The password-change API itself is on the `/auth` router
under `auth` (`auth.route.js`). I read the route file's header, not every handler, so that detail is to confirm. So
these users *may* change their password; they just have no way to find the page.

### Recommendation: give `account: READ` to all five roles

This matches USER, SUPERVISOR and ENGINEERING MANAGER, which already hold `account: READ`. It also shows those five
roles their Notifications page, which is personal and harmless. Do not add a separate `change-password` slug to
`MENU_SLUGS`: that would widen API-key scope vocabulary (ADR-043) for no gain.

**Why it matters more than "low" suggests.** Every flow that hands a user a credential they did not choose ends with
"now change your password": an admin setting an initial password, a Q-09 restored account, an operator helping over
the phone. For five of the eleven roles, the people most likely to share a workstation, the product hides the page
that finishes those flows.

**Migration:** a backfill modelled on `0025`/`0027`. It inserts the `account` grant for the five roles where absent,
never overwrites, and does nothing on an unseeded database. **At deploy:** flush `permissions:*` (ADR-049). The
change is additive, and the boot assertion (A-80) already guarantees `account` is a seeded slug.

**Steelman:** I cannot find a credible one. If a tenant wants a role to have no self-service at all, the per-role
override exists.

**Confidence: high.**

---

## §2: Sequencing, so the owner can say yes to parts of this

Ordered by *risk removed per unit of disruption*, with the free decisions first:

| Order | Change | Disruption | Why now |
|---|---|---|---|
| 1 | **Q-12:** remove `audit_logs` from both purge maps (F-3 included); ADR amending BR-6 | none visible | irreversible the day the first row turns 365 |
| 2 | **Verify F-1, F-2, F-4** with the named requests and queries | none | three answers depend on them |
| 3 | **A-107** state checks; route `cancelWorkflow` | admins lose a delete button they should not have had | 0 certificates today |
| 4 | **Q-19 / A-86** creation-time signer checks; fix the signing email link | workflows fail fast instead of hanging | 0 workflows today |
| 5 | **A-98** grant plus backfill; flush the permission cache | five roles gain a menu | small and additive |
| 6 | **Q-11** ADR (informational); fix F-2; OTP reset marks the address verified | none | prevents a future lockout |
| 7 | **Q-13** `SYSTEM_ACTORS` and the `logAction` check; **Q-15** lockout audit row | none | unblocks W-04 |
| 8 | **Q-10** creation refusal plus deactivation migration | none | small |
| 9 | **Q-16** FK convergence migration (planned deploy, orphan query the day before) | backend refuses to boot if orphans exist | free before the first hospital |
| 10 | **Q-17** presenter, then the regulated-authorship refusal | operators lose authorship of tenant evidence | trust in the audit list |
| 11 | **Q-09** item 3, together with D-11 | none | must not ship after D-11 |
| later | **Q-18** invitation / membership model; audit-log partitioning and archive; `REVOKE` grant; external signers | features | each has a named trigger above |

---

## §3: What I concede overall

1. **On data, I am closer to the compliance position than my brief implies.** Q-12 (no purge), Q-16 (`RESTRICT`),
   A-107 (no deletion after a signature) and Q-09 item 3 (never restore an erased person) are all "keep the data".
   I argue for them on *reversibility* grounds, and A will argue for them on regulatory grounds. The referee can
   treat those four as settled.
2. **Q-18 is where I am weakest.** I am keeping a known oracle on purpose. My answer rests on the login-ambiguity cost,
   which I believe is real but have not measured with users.
3. **Q-13's IoT exclusion and Q-15's "lockouts, not failures" are interpretations of Part 11**, not readings of it. A
   stricter reading is defensible, and both of my fallbacks (batch-level audit, and `LOGIN_FAILED` with a rate cap)
   are written down so the stricter answer does not have to be designed from nothing.
4. **Q-17 item 2 takes a capability away from the super admin.** I think no legitimate workflow needs it, but I have
   not asked the people who do platform support.
5. **Nothing here was run.** F-1 in particular is a strong claim from one line of code. If
   `POST /esignature/sign` works for a seeded technician, I have misread something, and Q-19's urgency drops.

---

## Summary

| Question | Recommendation | Confidence |
|---|---|---|
| **Q-09** restore of a missing account | Confirm the S-02 default (inactive, unusable credential, OTP reset, admin activates). Surface `skippedDeleted` with the undelete path. **Never re-create an erased subject** (HMAC ledger, shipped with D-11) | high (items 1-2) · medium-high (item 3) |
| **Q-10** global retention policy | No global policy rows. The env-var default *is* the global. Refuse creation, deactivate existing rows, put a retention minimum on `setRetentionPolicy` | high |
| **Q-11** unverified accounts | Informational only (ADR). Do not enforce at login. Fix F-2. OTP reset marks the address verified. No resend endpoint. Decide public registration separately | high |
| **Q-12** purge `audit_logs` | **No.** Remove from both purge paths (F-3). Index now, partition and archive later, `REVOKE` later. Mask IP and user agent for GDPR | high |
| **Q-13** system actor | A closed `SYSTEM_ACTORS` constant, `logAction` enforcing exactly one of user or system actor. No system user row. Audit work orders and offboarding, not IoT readings or session cleanup | high · medium (IoT) |
| **Q-14** tenant for cross-tenant change | Confirm BR-A41-4 as written, fail-closed. Document that tenants cannot see global role changes | high |
| **Q-15** failed sign-ins | Audit **lockouts** (`UPDATE`/User, `operation: LOCKOUT`) and failed signing re-authentication. Keep per-failure events in the security log. No ENUM migration | medium-high |
| **Q-16** tenant FKs | `RESTRICT` by default, `CASCADE` on a named ephemeral allow-list, `audit_logs` `RESTRICT`. A migration that refuses on orphans. Fix the associations. Data-driven test. Watch the snake_case write-drop trap | high |
| **Q-17** operator identity | "Platform operator" label through a presenter (audit list first). Operators do not author regulated evidence in a tenant. No include opt-out | medium-high |
| **Q-18** identity model | Keep global identity now, with uniform 409 answers on every create path and a global username check. Later, global identity with **invitation-based memberships**, not per-tenant uniqueness | medium |
| **Q-19** every role signs | Confirm. Check signer eligibility **at workflow creation**. Fix F-1 and the signing email link first | high |
| **A-107** delete revoked cert / completed workflow | **No** for `approved`, `signed`, `revoked` and any workflow with a signature (409). Route `cancelWorkflow`. Leave `revokeSignature` unrouted | high |
| **A-86** external signers | Refuse at creation (400). Do not build external signing. The vendor gets a USER account | high |
| **A-98** change password for all roles | `account: READ` for the five roles, backfill migration, flush `permissions:*` | high |
