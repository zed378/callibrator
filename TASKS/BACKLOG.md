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
| Q-04 | **How strict should session IP binding be?** | Strict binding breaks users on mobile networks and hospital wifi that hands out a different address per floor. The balance is a product decision and is currently emergent rather than stated. |
| Q-05 | **Should a parent tenant ever see child tenant data?** | Hierarchy exists; visibility does not follow from it. Every "group reporting" request runs into this. |
| Q-06 | **Does a tenant on its own storage bucket still count against `limitStorageMb`?** | Currently yes. Arguably it should not, since they are spending their own capacity. |
| Q-07 | **What is the break-glass procedure if mandatory MFA locks out the only super-admin?** | Blocks P6-07. It must not be "disable the check". |

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
