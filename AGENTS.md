# AGENTS.md — Roles and Working Agreements

Agent definitions for this repository. Operating instructions common to all of them are in [`CLAUDE.md`](CLAUDE.md); read that first.

---

## The Shared Contract

Every agent, regardless of role, is bound by these. They are not role-specific because violating them is not role-specific.

| | |
|---|---|
| **Tenant isolation** | deny-by-default, enforced by global hooks. Cross-tenant returns **404**, never 403. |
| **Every route has a permission gate** | nothing in the build enforces this |
| **Every mutation writes an audit row** | inside the transaction of the action |
| **Every new `:id` route has a two-tenant test** | asserting **404** |
| **Name the test** | an assertion that a test passed is not evidence |
| **Deviations get an ADR** | a documented deviation is a decision; an undocumented one is a bug nobody has found yet |
| **Nothing is `DONE` without its record** | `MEMORY/records/` |

**A multi-tenancy finding is not waivable by anyone.** Everything else is negotiable with a recorded decision naming who agreed.

---

## Backend Engineer

**Owns:** `backend/` — 53 route modules, 76 services, 72 models.

**Knows before touching anything:**

- The backend is **JavaScript, CommonJS**. There are no types to fix (ADR-030).
- The models barrel exports **`sequelize`**, not `db`.
- An optional include needs **`required: false`** — the most repeated defect shape here.
- `validate(schema)`, never `schema.validate`.
- Path parameters must reach the validator: `{ ...req.params, ...req.body }`.
- Transactions open in the **service**, never a controller.
- `sessions` uses **snake_case attributes**.

**Reads:** [`docs/BACKEND/00`](docs/BACKEND/00-BACKEND-STANDARDS.md) · [`docs/BACKEND/05`](docs/BACKEND/05-TENANT-SCOPING.md) · [`docs/BACKEND/10`](docs/BACKEND/10-MODULE-REFERENCE.md)

**Does not:** add a route without a gate · write raw SQL without a tenant predicate · use `skipTenantScope` without a comment · set `isSystemTask` around a whole consumer loop.

---

## Frontend Engineer

**Owns:** `frontend/` — ~60 dashboard surfaces, 51 API services.

**Knows before touching anything:**

- **Rows are in `data`; pagination is in a top-level `meta`.** Violating it renders an empty list with **no error**.
- Every list has **three** states — loading, empty, **failed**. `EmptyState` and `ErrorState` are separate components.
- Authorization is **not** a frontend concern. The sidebar renders from the server-resolved menu tree; an unauthorised surface is **absent**, not hidden.
- **`NEXT_PUBLIC_*` is inlined at build time.** A different API URL is a different image.
- A store is for state that **outlives a page**. Filters belong in the **URL**.
- React 19's compiler flags `setState` in effects and makes most manual memoisation unnecessary. Do not disable the rules.

**Reads:** [`docs/FRONTEND/00`](docs/FRONTEND/00-FRONTEND-STANDARDS.md) · [`docs/FRONTEND/03`](docs/FRONTEND/03-API-CLIENT.md) · [`docs/FRONTEND/08`](docs/FRONTEND/08-ERROR-BOUNDARIES.md)

**Never:** renders an empty list when a request failed. That is a lie about a compliance figure, and someone repeats it in a meeting.

---

## Database Engineer

**Owns:** the schema, 18 migrations, indexes.

**Knows before touching anything:**

- The platform runs on PostgreSQL **or MySQL**. `CREATE EXTENSION`, `JSONB` and generated-column syntax are not portable.
- **The Umzug context IS the QueryInterface.**
- **A blanket `try/catch` marks a migration applied while doing nothing.**
- Expand-and-contract for anything breaking. A rename in place breaks every running instance mid-deploy.
- `down` must exist **and be tested**. An untested `down` is a comment.

**After every migration:** verify the columns in `information_schema`. **The migration log is not evidence.**

**Reads:** [`docs/DATABASE/13`](docs/DATABASE/13-MIGRATIONS.md) · [`docs/ARCHITECTURE/04`](docs/ARCHITECTURE/04-DATABASE-ARCHITECTURE.md)

---

## Security Engineer

**Owns:** the controls, and the honesty about which are mechanisms and which are conventions.

**The current gaps, all documented and all open:**

| Gap | |
|---|---|
| `calibration_records` append-only is a **convention**, not a constraint | PR-2 → P6-03 |
| MFA not enforced, including for `SUPERADMIN` — which has no second gate behind it | PR-3 → P6-07 |
| No build guard fails a route missing a permission gate | → P6-04 |
| `serialNumber` is globally unique — a weak cross-tenant oracle | → P6-06 |
| Neither `CERT_SIGNING_SECRET` nor `ENCRYPT_KEY` is rotatable | → P6-10 |

**Rules for testing a control:**

- **Test database grants as the application role.** As the owner the test passes whether the grant exists or not — a green tick for an absent control.
- **A self-verifying test proves consistency, never correctness.**
- **Mutation-check anything load-bearing:** break the thing, watch the right test fail. A test nobody has seen fail is a test nobody knows is connected.

**Reads:** all of [`docs/SECURITY/`](docs/SECURITY/00-SECURITY-REQUIREMENTS.md). [`05`](docs/SECURITY/05-MULTI-TENANCY-SECURITY.md) is mandatory for everyone.

---

## DevOps Engineer

**Owns:** `deploy/`, the Makefile, the images.

**Knows before touching anything:**

- Both applications compile to **binaries**. Runtime assets — `swagger.json`, `src/templates`, `docs/` — must be copied explicitly, or the API starts fine and fails on the first PDF or email.
- **Puppeteer needs a system Chromium**, and it fails at **first use, not startup**.
- **`ACME_DIRECTORY_URL` defaults to Let's Encrypt staging** — certificates no browser trusts, failing in a browser rather than in any log.
- **`/socket.io/*` needs upgrade headers**, or Socket.IO silently falls back to long-polling.
- **`/oidc/*` is at the root**, not under `/api/v1`.
- **Schedulers run once per replica.**
- `.dockerignore` is read from the **build context root**, not from beside the Dockerfile.

**Honest state:** the Helm charts **render**; no cluster has been reachable. The Makefile is **statically checked**; `make` was not available to run it.

**Reads:** [`deploy/README.md`](deploy/README.md) · [`docs/DEVOPS/`](docs/DEVOPS/00-ENVIRONMENTS.md)

---

## QA Engineer

**Owns:** 342 backend test files, 53 live E2E specs, 51 contract tests, and a Playwright suite that is **not in this repository** (see U-07).

**The founding lesson:** **3,863 tests passed while 13 endpoints were broken.** Services had been written against endpoints that did not exist, with tests mocking the fabrication.

> A mock proves the code calls what the developer believed. Only a live call proves the endpoint exists and answers that way.

**Two operational rules, both learned by breaking things:**

- **Never suspend the default tenant.** It suspends the super-admin living in it and 403s every later request; recovery is a direct database update.
- **Watch the rate limiter.** Repeated runs exhaust even the non-production budget and produce failures unrelated to the code.

**Currently failing:** the E2E suite has **never passed in one uninterrupted run**. The backend coverage gate **passes** (2026-09-11: 289 suites, 5735 tests, 100%).

**Never** makes a suite green by deleting the failing test. Two expected-failure markers are retained deliberately.

**Reads:** [`docs/TESTING/`](docs/TESTING/00-TEST-STRATEGY.md)

---

## Documentation Writer

**Owns:** `docs/` — 135 as-built documents.

**The rule that governs everything here:** **ground every claim in code, and name the file.** A sentence that cannot be traced is a guess, and guesses in reference material get copied into implementations.

That is not a stylistic preference. `CLAUDE.md` once told agents to write TypeScript for a JavaScript backend, and it was believed.

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
make verify        # lint · typecheck · test · build
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
