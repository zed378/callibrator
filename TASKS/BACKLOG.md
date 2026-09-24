# Backlog

Open questions, specification gaps, and deliberate deferrals.

**A task that would need a decision `docs/` does not contain is not a task** — it is an entry here, to be raised with the project owner.

Items promoted to a phase carry a link. Items with no consequence anywhere are noise, so everything here either has a phase task, a trigger, or an owner question attached.

---

## Open Questions — need an owner decision

| # | Question | Why it matters |
|---|---|---|
| Q-01 | **Should `calibration_records` become genuinely immutable at the database level?** | It would break the existing `PUT`/`DELETE` routes. Under Part 11 the current state is a finding; the decision is whether a correction path is needed and what it looks like. → P6-03 |
| Q-02 | **Is a "retired" device permanently retired?** | `retired` is terminal by convention only. Reviving one is possible at the database level and probably should not be. |
| Q-03 | **How long must `audit_logs` be retained?** | It has **no delete path**, and purging it is a compliance decision, not an engineering one. Without an answer, P8-06 cannot be scoped. |
| Q-04 | **How strict should session IP binding be?** | Superseded by Q-08 — the premise was wrong. There is no binding to be strict or loose about. |
| Q-05 | **Should a parent tenant ever see child tenant data?** | Hierarchy exists; visibility does not follow from it. Every "group reporting" request runs into this. |
| Q-06 | **Does a tenant on its own storage bucket still count against `limitStorageMb`?** | Currently yes. Arguably it should not, since they are spending their own capacity. |
| Q-07 | **What is the break-glass procedure if mandatory MFA locks out the only super-admin?** | Blocks P6-07. It must not be "disable the check". |
| Q-08 | **Should session fixation protection, a concurrent-session limit and IP/user-agent binding exist at all — and if so, what is the behaviour when a client's IP changes, and whose session is evicted when the limit is reached?** | Supersedes Q-04. Six documents described all three as in place; none of them ever ran. `sessionSecurity.middleware.js` was imported by nothing and its SQL targeted a `"Sessions"` table with camelCase columns, so it was deleted **2026-09-23** (A-12) rather than wired in — wiring it in would have changed authentication behaviour on a judgement nobody made. Each half of the question has a user-visible cost: IP binding logs people out when a mobile network or hospital wifi rotates an address, and a concurrent-session cap means one login silently kills another. Today `auth.middleware.js` states its own scope as *"RBAC Only - No Session Validation"* — it never reads the `sessions` table, which is also why a revoked session stays usable until its access token expires. **Part of the same question:** whether the Socket.IO handshake should be stricter than HTTP. It came up in the 2026-09-23 realtime work, and sockets enforcing a session rule that HTTP does not gives two different answers to "is this session still valid", which is the shape of defect that makes a control untrustworthy rather than absent. |
| Q-09 | **When a tenant backup is restored, what happens to an account that is in the backup but no longer in the tenant?** | Taken as a default on 2026-09-24 (S-02) and open for the owner to overturn: it is re-created **inactive, with a random password nobody holds**, listed in the restore's `pendingActivation`, and its holder resets it through the existing email OTP before an admin activates it. That satisfies "never left with an empty or guessable credential" but not "usable immediately". The strict alternative — never re-create a missing account, only report it — is simpler to reason about and loses the account instead. |
| Q-10 | **Should a tenant-less (global) retention policy exist at all?** | Since 2026-09-24 (D-03) such a policy purges **nothing**: the unsafe branch purged every tenant's rows, audit logs included, and ignored legal hold. `dataRetention.service.js#runRetentionSweep` already applies a retention period per tenant under its own filter. So a global policy row is now inert — which is safe, and is also a record that looks like it does something and does not. Either give global policies a defined meaning (a default each tenant inherits unless it sets its own), or remove the ability to create one. |
| Q-11 | **May an account that never used its activation link log in?** | `loginUser` never checks `isEmailVerified` (A-60), so activation gates nothing today, and there is no resend endpoint. Enforcing it would lock out every existing unverified account, including seeded ones. Decide: enforce (and add resend), or record that email verification is informational only. |
| Q-12 | **May `audit_logs` be purged at all?** | `docs/DATABASE/10-AUDIT-LOGS.md` BR-6 says there is "no delete path anywhere in the codebase". The retention purge deletes audit rows after 365 days, and since 2026-09-24 it records that it did (W-04). One of the two is wrong, and 21 CFR Part 11 retention usually outlives 365 days. Decide the retention period for audit rows, or exclude them from the purge; the document is then amended through an ADR. |
| Q-13 | **Should background jobs have a first-class system actor?** | The purge writes `userId: null` and names itself in `changes.actor`. Offboarding, scheduled work orders and IoT ingest need the same answer before W-04 can close. |
| Q-14 | **Which tenant is a cross-tenant change recorded under?** | A-41 took a default (spec BR-A41-4): a change to a global role goes under the actor's home tenant; a change to a user's role or override goes under that user's tenant, falling back to the actor's; if neither resolves, the change is refused. Confirm or change. |
| Q-15 | **Should failed sign-ins be audit rows?** | Since A-72, successful password, MFA and SSO logins write `LOGIN` rows. Failures go only to the winston log, because the `audit_logs` action ENUM has no `LOGIN_FAILED` and an unknown username has no tenant. Adding one needs an ENUM migration, an `AUDIT_ACTIONS` change and an ADR. |
| Q-16 | **How should `tenant_id` foreign keys behave?** (A-88) | 49 associations use `foreignKey: "tenant_id"` — the column name — which gives 39 tables a **nullable** `tenant_id` with `ON DELETE SET NULL` on a `sync()`-built database, among them certificates, calibration records, e-signatures and users. Fixing the association makes a fresh database NOT NULL with **CASCADE**, which would **hard-delete regulated records** with a tenant, while existing databases stay as they are. Decide the delete action per table (RESTRICT or NO ACTION is likely right for Part 11 records), then a migration makes existing and fresh databases converge after resolving orphaned rows. Relates to W-20 and Q-12. |
| Q-17 | **How do platform-operator identities appear to tenants?** (ADR-048) | Since A-87, a reference to the super admin (a ticket assignee, a calibration performer, a backup creator) reads as `null` to tenant users, because the super admin's user row is in another tenant. Decide: show "Platform operator", allow a narrow opt-out for those includes, or stop super admins authoring tenant records. |
| Q-18 | **Is a user account global or per tenant?** (A-37, D-06) | `users.email` and `users.username` are globally unique, which makes every user-creation path a cross-tenant existence oracle. A-37 hides the signal on SCIM only. Per-tenant uniqueness closes it, but login looks users up by email, so an address in two tenants makes login ambiguous (a tenant selector, or a tenant-qualified login, would be needed), and the super admin's NULL tenant needs a partial index. Decide the identity model; it needs an ADR. |
| Q-19 | **Confirm: may every role sign?** (A-84, ADR-049) | The default grant gives all 11 seeded roles `esignature: write`, because any tenant user can be named a signer and A-65 refuses everyone but the named signer. A tenant can withdraw it per role or per user. |

---

## Specification Gaps

Places where `docs/` is silent, contradictory, or where the code and the contract disagree.

| # | Gap | State |
|---|---|---|
| G-01 | **Swagger and the enforced Joi validators disagree for the GDPR endpoints** | documented drift → P6-08 |
| G-02 | **Two `billingCycle` vocabularies** — `monthly`/`yearly` on `tenants`, `Monthly`/`Annually` on `subscriptions` | a case transform is not enough; mapping code must be explicit (PR-13) |
| G-03 | **`UsageMetrics` is the one camelCase table name** | needs quoting in raw SQL on PostgreSQL (PR-15) |
| G-04 | **`sessions` uses snake_case attribute names** | already caused the nightly purge failure (PR-14) |
| G-05 | **`tenant_backups` has duplicated column pairs** — `filePath`/`backupPath`, `fileSize`/`size` | a migration artefact; check which the service writes |
| G-06 | **`notifications.isRead` coexists with `notification_states.isRead`** | two sources for one fact, and they can disagree |
| G-07 | **`menu_groups` supports a tree the UI does not use** | `parentId` exists; navigation is two levels |
| G-08 | **`packages/*` matches nothing** | the workspace glob is aspirational; a JavaScript backend and a TypeScript frontend share no code |
| G-09 | **The root declares workspaces twice** | npm-style `workspaces` in `package.json` **and** `pnpm-workspace.yaml` |
| G-10 | **`ROLE_NAMES.HEALTCARE_ADMIN` is missing its `H`** | preserved deliberately — renaming needs coordinated seed and consumer changes for no behavioural gain |

---

## Audit 2026-09

Every finding from the 2026-09-21 audit is a task in [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md), not an entry here. Items below that the audit touched point at their `A-nn` task.

## Mechanisms That Should Exist and Do Not

The highest-value entries here. Each is a control currently held together by convention.

| # | Missing mechanism | Consequence today | → |
|---|---|---|---|
| M-01 | **A build guard failing any route without a permission gate** | a new route works for everyone with a token; nothing fails the build | **P6-04** |
| M-02 | **A database `REVOKE` on `calibration_records`** | append-only is a convention; the model is `paranoid` with `PUT`/`DELETE` routes | **P6-03** |
| M-03 | **Post-migration column verification** | a blanket-catch migration is recorded as applied while doing nothing | **P6-05** |
| M-04 | **A composite unique on `(tenant_id, serial_number)`** | a uniqueness failure reveals another tenant holds that serial | **P6-06** |
| M-05 | **Enforced MFA at role level 10** | the account with no second gate behind it has no second factor either | **P6-07** |
| M-06 | **A rotation procedure for `CERT_SIGNING_SECRET` / `ENCRYPT_KEY`** | "rotate the key" is **not an available incident response** | **P6-10** |
| M-07 | **IP allowlist validated against the caller's current address** | an administrator can lock themselves out with no in-product recovery (T31) | — |
| M-08 | **Alerting on scheduled-job outcomes** | a nightly compliance job can fail silently, and has | **P7-02** |
| M-09 | **A `REVOKE` test run as the application role** | as the owner it passes whether the grant exists or not — a green tick for an absent control | P6-03 |
| M-10 | **A middleware defaulting `req.body` to `{}`** | Express 5 leaves an absent body `undefined`; every unguarded `req.body.x` is a 500 waiting for a bodyless request. One shipped (`/menu-groups/admin`) and reached production | — |

---

## Deliberate Deferrals

Decided, not forgotten. Each has a trigger.

| # | Deferred | Trigger |
|---|---|---|
| D-01 | **Data lake / warehouse** | measured impact of reporting on operational p95 — and the answer is a **read replica first** (P8-04) |
| D-02 | **Partitioning `iot_readings` and `audit_logs`** | row counts making retention insufficient (P8-05, P8-06) |
| D-03 | **CI pipeline** | P6-01 first — do not build a pipeline around a failing gate (P7-01) |
| D-04 | **Multi-region** | a customer requirement, not a technical one (P8-08) |
| D-05 | **Generating frontend types from `swagger.json`** | worth doing — but a generator would faithfully reproduce the G-01 drift, so P6-08 comes first |
| D-06 | **JSDoc with `checkJs` on the backend** | open. Buys editor-level checking without a rewrite (ADR-030) |
| D-07 | **Migrating the backend to TypeScript** | **rejected on cost**, not merit. Recorded so it is not re-proposed without new information |
| D-08 | **A hierarchical location tree** | rejected — correct on paper, unmanageable in a UI where a clerk needs two taps (ADR-023 divergence) |

---

## Known Warts, Accepted

Documented so nobody spends an afternoon rediscovering them, and so nobody "fixes" one without knowing why it is there.

| # | Wart | Why it stays |
|---|---|---|
| W-01 | `POST /users/detail` fetches by POST with the id in the body | breaking API change for no functional gain |
| W-02 | `DELETE /users/delete?userId=` reads the id from the **query string** | same |
| W-03 | Warehouse location **reads are nested, writes are flat** | same |
| W-04 | `PATCH` for stock, `PUT` for devices | same |
| W-05 | `menu-group-roles` serves the **same router** as `menu-groups` | same |
| W-06 | `GET /menu-groups/menu-groups/admin` — a real doubled path | the contract test asserts it, documenting reality |
| W-07 | An expired token reports **"Invalid token"** rather than a distinct message | changing it churns a fully-covered suite for no security or usability gain |
| W-08 | Schedulers live in `middlewares/` | they are installed at app assembly; the directory name misleads |
| W-09 | The API CSP allows `'unsafe-inline'` for bundled swagger-ui | → P7-08; the reasoning does **not** transfer to the content-rendering origin |
| W-12 | `account.html` in `src/templates` is **referenced by no code** | a dead template; it was fixed alongside the live two rather than left carrying a third party's URLs, but it ships and renders nothing |
| W-11 | **No lockfile is committed** — `.gitignore` excludes `pnpm-lock.yaml`, `package-lock.json` and `bun.lock` | every install and every image build resolves transitive versions fresh, so a build today and a build next month can ship different dependencies. The frontend Dockerfile documents it in place; the fix is to commit one |
| W-10 | Several controllers read `req.body.x` **unguarded** | on Express 5 an absent body is `undefined`, not `{}` — see M-10; the remaining sites are all POST/PATCH, where a bodyless request is already a client error, but it answers **500** instead of 400 |

---

## Unverified Claims

Things this repository currently asserts that **have not been demonstrated**. Kept visible so they are not rounded up in a status report.

| # | Claim | Actual state |
|---|---|---|
| U-01 | The Helm charts deploy | **they render.** `helm lint` and `helm template` pass and both guards fire; **no cluster has been reachable** → P7-06 |
| U-01a | ~~The compose stack deploys~~ | **RESOLVED 2026-09.** Running on a single host behind a Cloudflare tunnel: seven services healthy, browser login working, certificate verification reachable. Nine defects were found doing it — recorded in the Phase 0 retrospective |
| U-02 | The E2E suite passes | **every fix verified individually.** It has **never passed in one uninterrupted run** → P6-02 |
| U-03 | The Makefile works | **statically checked** — 85 targets, correct tab indentation. **`make` was not available to execute it.** The first real deployment ran `docker compose` directly, so the targets are still unexercised |
| U-04 | RTO is 4 hours | **a guess.** No restore drill has ever been performed → P7-04 |
| U-05 | Backups are good | **assumed, not known.** No scheduled restore verification exists |
| U-06 | Performance targets are met | **design intentions.** No load testing has been performed; no baseline exists → P8-07 |
| U-07 | The `automate/` Playwright suite runs 71 browser tests | **the directory is not in this repository.** It is untracked by git and absent from disk, while six documents describe it and `make test-browser` invokes it. The 71-test result comes from the 2026-07 audit; nothing here can reproduce it. Either the suite is restored to the repo or the claim is withdrawn |

---

## How to Use This File

**Raise a question before coding, not after.** An item in Open Questions is blocking by design — proceeding on a guess and recording it afterwards is how the specification drifted the first time.

**When an item is resolved:** move it into a phase file as a task, write the ADR if it was a decision, and **leave a line here pointing at where it went**. Deleting it loses the record that it was ever open.

**When a new one is found during work:** add it here in the same commit, and reference it from the change record. An open question mentioned only in a record has no consequence.
