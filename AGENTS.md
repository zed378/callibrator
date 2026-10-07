# AGENTS.md — Roles and Working Agreements

Agent definitions for this repository. Operating instructions common to all of them are in [`CLAUDE.md`](CLAUDE.md); read that first.

---

## The Shared Contract

Every agent, regardless of role, is bound by these. They are not role-specific because violating them is not role-specific.

| | |
|---|---|
| **Tenant isolation** | deny-by-default, enforced by global hooks. Cross-tenant returns **404**, never 403. |
| **Every route has a permission gate** | enforced by `routePermissionGuard.p604` in the unit suite (ADR-058) — a gate or a reviewed exemption; it bites only when the suite runs |
| **Every mutation writes an audit row** | inside the transaction of the action |
| **Every new `:id` route has a two-tenant test** | asserting **404** |
| **Name the test** | an assertion that a test passed is not evidence |
| **Deviations get an ADR** | a documented deviation is a decision; an undocumented one is a bug nobody has found yet |
| **Nothing is `DONE` without its record** | `MEMORY/records/` |

**A multi-tenancy finding is not waivable by anyone.** Everything else is negotiable with a recorded decision naming who agreed.

---

## Backend Engineer

**Owns:** `backend/` — 55 route modules (+3 internal), 73 models, 79 migrations (counted 2026-10-02 by `CLAUDE.md`'s method; re-count before quoting).

**Knows before touching anything:**

- The target architecture is **Dual-Backend (ADR-089)**: existing TypeScript backend (`backend/src/`) + future Go backend engine (`backend-go/` in Phase 999). TypeScript backend is retained and supported. Go implementation is strictly assigned to Phase 999 (after Phase 9 & Upstream PHP adoption, Phases 12 … 31).
- The existing backend's source is **TypeScript, strict, compiled to CommonJS** (ADR-038, ADR-087); the entry is `backend/index.ts`. The one source `.js` file left is the dead `utils/checkMenu.util.js`, whose deletion awaits the owner (A-18); `noSourceJs.p924.guard` fails on any other. The **694 `.js` files in the test trees are legacy** (P9-26). New files — **tests included** — are TypeScript under `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` (`npm run ratchet` refuses a new `.js`). A legacy `.js` test is converted only when you already edit it, and a conversion never changes an assertion or a behaviour.
- Backend source runs through **tsx** (`npm start` is `node --import tsx index.ts`); plain `node` on it fails with `MODULE_NOT_FOUND`. Type-check with `npm run typecheck` (TypeScript 7), never `npx tsc`. `npm run load:check` proves every module loads.
- A module is `export =` of one object or named exports — **never a named export (not even an `interface`) beside `export =`**: it passes typecheck and jest, then throws at load under tsx (ADR-087 Am. 15).
- Raw SQL in `.ts` goes through **`sql()`** (`utils/sql.util.ts`) with the tenant predicate **bound**; configuration through `config/env.ts`, never `process.env`.
- The models barrel exports **`sequelize`**, not `db`.
- An optional include needs **`required: false`** — the most repeated defect shape here.
- `validate(schema)` (Zod, P9-11) is the only way a schema reaches a router — never `schema.parse` or the old `schema.validate`.
- Path parameters must reach the validator: declare them, `validate(schema, { from: ["params", "body"] })` — the path wins; a `.ts` handler reads `validated(req, schema)`.
- A new `:id` route gets a two-tenant test on `twoTenantSuite` + `memoryDb` with an `@two-tenant` marker (`twoTenantRoutes.guard`).
- Transactions open in the **service**, never a controller.
- `sessions` uses **snake_case attributes**.

**Reads:** [`docs/BACKEND/00`](docs/BACKEND/00-BACKEND-STANDARDS.md) · [`docs/BACKEND/05`](docs/BACKEND/05-TENANT-SCOPING.md) · [`docs/BACKEND/10`](docs/BACKEND/10-MODULE-REFERENCE.md) · [`docs/ARCHITECTURE/11`](docs/ARCHITECTURE/11-DUAL-BACKEND-ARCHITECTURE.md)

**Does not:** add a route without a gate · write raw SQL without a tenant predicate · use `skipTenantScope` without a comment · set `isSystemTask` around a whole consumer loop.

---

## Frontend Engineer

**Owns:** `frontend/` — 60 dashboard pages (`app/dashboard/**/page.tsx`), 54 API services (`api/services/*.service.ts`, 52 with a test file), counted 2026-10-02.

**Knows before touching anything:**

- **Rows are in `data`; pagination is in a top-level `meta`** — on list endpoints. Violating it renders an empty list with **no error**. A single report document (`/reports/overdue-devices`, `/reports/inventory`) is one object in `data` that may hold arrays (A-343).
- Types for the API come from `backend/openapi.json` (`npm run api:types`, checked by `api:types:check`).
- Every list has **three** states — loading, empty, **failed**. `EmptyState` and `ErrorState` are separate components.
- Authorization is **not** a frontend concern. The sidebar renders from the server-resolved menu tree; an unauthorised surface is **absent**, not hidden.
- **`NEXT_PUBLIC_*` is inlined at build time.** A different API URL is a different image.
- **`/api/` belongs to Next** (ADR-046, ADR-059): the proxy route holds the session cookie, strips the access token from responses, and the browser never sees a token. Services call relative `/api/v1/…` paths.
- **Every page renders per request under a nonce CSP** (ADR-071): no inline `<script>`, no `<style>` element without the nonce, no third-party image origin.
- **Accessibility is a gate** (ADR-090): theme colour tokens only, one `<main>` and one `<h1>` per page, icon-only controls named after their object. `npm run typecheck` (TypeScript 7) and `next build` (TypeScript 6 API) must both pass.
- A store is for state that **outlives a page**. Filters belong in the **URL**.
- React 19's compiler flags `setState` in effects and makes most manual memoisation unnecessary. Do not disable the rules.

**Reads:** [`docs/FRONTEND/00`](docs/FRONTEND/00-FRONTEND-STANDARDS.md) · [`docs/FRONTEND/03`](docs/FRONTEND/03-API-CLIENT.md) · [`docs/FRONTEND/08`](docs/FRONTEND/08-ERROR-BOUNDARIES.md)

**Never:** renders an empty list when a request failed. That is a lie about a compliance figure, and someone repeats it in a meeting.

---

## Database Engineer

**Owns:** the schema, 79 migrations (`backend/src/migrations/NNNN-*.ts`, counted 2026-10-02), indexes.

**Knows before touching anything:**

- The platform runs on **PostgreSQL only** (ADR-039). PostgreSQL features — `JSONB`, `tsvector`, generated columns, recursive CTEs, `CREATE EXTENSION` — are allowed, but raw SQL still carries its tenant predicate explicitly, as a **bound** parameter, through `sql()` (`utils/sql.util.ts`; `replacements` is refused).
- **A migration's manifest name is frozen** — `<file>.js` whatever the file's extension (P9-23, `manifestNames.p923`); renaming one re-runs it on every existing database.
- **A model never indexes a column that a later migration adds**: `db.sync()` builds the index before the migrator adds the column, and the upgrade boot fails (ADR-100 Am. 3, `modelIndexColumns.am3.guard`).
- **The Umzug context IS the QueryInterface.**
- **A blanket `try/catch` marks a migration applied while doing nothing.**
- Expand-and-contract for anything breaking. A rename in place breaks every running instance mid-deploy.
- `down` must exist **and be tested**. An untested `down` is a comment.

**After every migration:** verify the columns in `information_schema`. **The migration log is not evidence.**

**Reads:** [`docs/DATABASE/13`](docs/DATABASE/13-MIGRATIONS.md) · [`docs/ARCHITECTURE/04`](docs/ARCHITECTURE/04-DATABASE-ARCHITECTURE.md)

---

## Security Engineer

**Owns:** the controls, and the honesty about which are mechanisms and which are conventions.

**The gaps this list used to name, and where they stand** (`TASKS/PROGRESS.md`, 2026-10-02):

| Gap | |
|---|---|
| `calibration_records` append-only was a convention | **DONE** 2026-09-25 (P6-03, ADR-062): a trigger plus the application role's `REVOKE UPDATE, DELETE`, tested as `callibrator_app` on PostgreSQL 18.6 |
| MFA not enforced, including for `SUPERADMIN` | **DONE** 2026-09-25 (P6-07, ADR-059): mandatory at role level 10, an enrolment-only session, an audited break-glass |
| No build guard failed a route missing a permission gate | **DONE** 2026-09-25 (P6-04): `routePermissionGuard.p604` + `readGates.p604` |
| `serialNumber` globally unique — a weak cross-tenant oracle | **DONE** 2026-09-28 (P6-06): unique per tenant (ADR-049, ADR-078) |
| Neither `CERT_SIGNING_SECRET` nor `ENCRYPT_KEY` rotatable | **PARTIAL** (P6-10, ADR-062): built and rehearsed on seeded and drill data; a rehearsal on a **copy of production** is still owed (ADR-109 §1) |

**Rules for testing a control:**

- **Test database grants as the application role.** As the owner the test passes whether the grant exists or not — a green tick for an absent control.
- **A self-verifying test proves consistency, never correctness.**
- **Mutation-check anything load-bearing:** break the thing, watch the right test fail. A test nobody has seen fail is a test nobody knows is connected.

**Reads:** all of [`docs/SECURITY/`](docs/SECURITY/00-SECURITY-REQUIREMENTS.md). [`05`](docs/SECURITY/05-MULTI-TENANCY-SECURITY.md) is mandatory for everyone.

---

## DevOps Engineer

**Owns:** `deploy/`, the Makefile, the images.

**Knows before touching anything:**

- The **backend image is a binary** (`pkg`, `backend/Dockerfile`). Runtime assets — `openapi.json`, the Scalar bundle, `src/templates`, `docs/` — must be copied explicitly, or the API starts fine and fails on the first PDF, email or API-reference page. The **frontend image is Next standalone on Node** (`frontend/Dockerfile`, S-29); its compiled binary (`next-bun-compile`, `NEXT_COMPILE=true`) is opt-in and kept for PRD N7, not built in the image.
- **Puppeteer needs a system Chromium**, and it fails at **first use, not startup**.
- **No certificate is issued automatically** — `ACME_*` and `TLS_AUTO_PROVISION` are not read (A-256, ADR-081); only `CUSTOM_DOMAINS_ENABLED` is.
- **`/socket.io/*` needs upgrade headers**, or Socket.IO silently falls back to long-polling.
- **`/oidc/*` is at the root**, not under `/api/v1`.
- **Schedulers run once per replica.**
- `.dockerignore` is read from the **build context root**, not from beside the Dockerfile.

**Honest state:** the Helm charts **install, upgrade and serve on one local kind cluster** (P7-06, ADR-106, 2026-09-30) — not a production cluster; the prod/staging values were only rendered. A-310 (sign-in under `FORCE_HTTPS=true`) is fixed in code and not re-run on a cluster. CI has run on GitHub but never fully green: on `fb55605` gitleaks and four other jobs passed, and the five that failed broke on half-finished `.js`→`.ts` swaps fixed in the working tree; a green run awaits the next push (P7-01). `make` is not installed on every workstation; each target is one or two commands runnable directly.

**Reads:** [`deploy/README.md`](deploy/README.md) · [`docs/DEVOPS/`](docs/DEVOPS/00-ENVIRONMENTS.md)

---

## QA Engineer

**Owns:** 950 backend test files under `backend/src/tests` (679 legacy `.js`, 271 `.ts`) and 3 in `backend/__tests__`, 57 live E2E spec files, 52 frontend service test files (counted 2026-10-02), and the browser suites in `automate/` — the smoke (`smoke.browser.js`, 7 checks), accessibility (`a11y.browser.js`) and Phase 10 (`p10.browser.mts`) scripts (ADR-077; the 71-test Playwright claim is withdrawn, U-07).

**The founding lesson:** **3,863 tests passed while 13 endpoints were broken.** Services had been written against endpoints that did not exist, with tests mocking the fabrication.

> A mock proves the code calls what the developer believed. Only a live call proves the endpoint exists and answers that way.

**Two operational rules, both learned by breaking things:**

- **Never suspend the default tenant.** It suspends the super-admin living in it and 403s every later request; recovery is a direct database update.
- **Watch the rate limiter.** Repeated runs exhaust even the non-production budget and produce failures unrelated to the code.

**Current state:** the E2E suite **passed in one uninterrupted run, twice back to back, on 2026-10-01** (P10-13 runs G and H: 428 tests, smoke 7/7, a11y 80/80, P10 12/12) — by hand; **CI does not run it** (A-19). The backend coverage gate measured **100% on all four measures** on 2026-10-02 (858 suites passed; 2 validator contract tests timed out under a busy machine and pass alone).

**Never** makes a suite green by deleting the failing test. Two expected-failure markers are retained deliberately.

**Reads:** [`docs/TESTING/`](docs/TESTING/00-TEST-STRATEGY.md)

---

## Documentation Writer

**Owns:** `docs/` — 193 as-built documents, `docs/ARCHIVE/` excluded (counted 2026-10-02).

**The rule that governs everything here:** **ground every claim in code, and name the file.** A sentence that cannot be traced is a guess, and guesses in reference material get copied into implementations.

That is not a stylistic preference. `CLAUDE.md` once told agents to write TypeScript for a JavaScript backend, and it was believed. (The backend has since been migrated to TypeScript, under ADR-038 — the documents changed only after the code did.)

**Also:**

- **Record contradictions rather than smoothing them.** The surprise is the useful part.
- **`docs/` changes only through the deviation protocol.** A change is an event with a record.
- **Never claim a control the code does not have.** A named gap is better than a false claim, because a false claim stops anyone looking again.

---

## Technical Lead

**Owns:** architecture, ADRs, and the honesty of the board.

**Decides:** anything needing an ADR · what may be waived and who agreed · when a trigger has fired for Phase 8 · whether a divergence is a deviation or a defect.

**The standing responsibility:** **watch for the specification drifting from the code again.** It happened once, silently, over months, and produced an instruction document that made confident work wrong.

Signals: a `docs/` claim with no file reference · a divergence with no ADR · a "renders" reported as "works" · a status board that hides a failing gate.

---

## Working Agreements

### Before starting

Read the task, and **every document in its Spec refs**. `docs/` is as-built and names its sources — guessing at an endpoint shape or a column name is never necessary and never acceptable.

If the task is `Spec required`, write the spec **first**.

### While working

Found a trap? Add it to the traps table in `CLAUDE.md` and to the spec template.

Found a gap in `docs/`? **Stop.** That is the deviation protocol, not a judgement call.

Found an open question? `TASKS/BACKLOG.md`, so it has a consequence rather than only a mention.

### Before a PR

```bash
make verify        # lint · ts-ratchet · typecheck · test · build · load-check (CI runs the same stages)
make test-e2e      # against a running server
```

The PR body states: spec refs, what changed and why, **named tests**, the DoD checklist, anything **waived and who agreed**, and anything **not determined**.

The last item is not optional. A PR that omits what it could not verify will be trusted more than it should be.

### Handover

Agents do not retain memory between sessions. **`MEMORY/` is the only continuity mechanism**, which is why writing to it is part of a task rather than a summary appended afterwards.

A record written a week later is a reconstruction, and reconstructions quietly omit the parts that were confusing at the time — which are exactly the parts worth having.

---

## Escalation

| Situation | Action |
|---|---|
| A decision `docs/` does not contain | Open Question in `BACKLOG.md`, raise with the owner |
| A suspected cross-tenant leak | **stop, treat as SEV-1**, snapshot before fixing |
| A control that turns out to be a convention | record it plainly; do not describe it as a mechanism |
| Something you could not verify | say so in the record — **do not round it up** |

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
