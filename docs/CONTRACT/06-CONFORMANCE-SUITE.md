# 06 — The Conformance Suite (TARGET)

> **TARGET — nothing here is built.** As built: the live E2E suite, **57 spec files** under
> `backend/src/tests/e2e/` (green twice in a row on 2026-10-05, runs S and T, on a disposable compose
> stack; **not in CI**, A-19); the two-tenant route tests over `memoryDb` (151 `:id` routes plus 50 on a
> reviewed allow-list, guarded by `twoTenantRoutes.guard`). Those tests import the backend's models
> and fixtures, so they prove **Node**, not "a backend". Decision: ADR-136.

---

## 1. What It Is

One **black-box** suite in `conformance/` (repository root). It talks to **`BACKEND_URL`** (and
`SOCKET_URL`) over HTTP and Socket.IO only. It imports nothing from any backend. It loads its seed data
as **plain SQL** into the database the backend under test uses. It reports results **per module and per
rule**.

> **A port, or one module of a port, is done only at 100% of its module's checks.** CI runs the suite
> against **every backend** on every change to that backend or to `contracts/`.

It is written in TypeScript (a client is allowed to be in any language, and TypeScript reuses the
generated client types). Contract fuzzing uses **Schemathesis** (Python, run as a container). Neither
choice binds a backend's language.

## 2. Harness

| Piece | Rule |
|---|---|
| Target | `BACKEND_URL` (HTTP), `SOCKET_URL`, `DATABASE_URL` (for seeding and read-only assertions only; never to bypass the API for a check) |
| Environment | the disposable compose stack of ADR-077, parameterised by engine (`ENGINE=node\|go\|…`) and, under the strangler, by the gateway's routing table |
| Seed | `contracts/fixtures/*.sql`: two tenants (A, B); in A two client facilities (F1, F2) plus the self facility; principals per role, unbound and bound; a published catalogue; known devices, sessions and records; fixed UUIDs. Loaded by the harness (`psql`) after the engine's migrations ([`07`](./07-PORTING-PLAYBOOK.md) § 3) |
| Sign-in | through the contract's own sign-in operations (no token minting by the harness), so authentication itself is tested |
| Isolation per run | a fresh database per run (or per module group), as the live suites do today ("drop a database instead of deleting audit rows", ADR-095 Am. 1 pattern) |
| Output | JUnit + a JSON score: `{ module: { checks, passed, failed: [ruleId…] } }` that CI publishes and the porting playbook reads |

## 3. The Five Parts

### 3.1 Functional — the live E2E specs, made black-box

The 57 live spec files become `conformance/functional/<module>/*.test.ts`:
- every import of backend code (models, fixtures, services) is replaced by a contract-typed HTTP call or
  a SQL fixture;
- every assertion is about the contract (status, `code`, envelope, response schema), never about Node
  internals;
- each spec is tagged with its module (`x-module`) and the rules it proves (`B-…`).

A spec that cannot be expressed black-box (it inspects a Node internal) stays in the Node suite and is
**not** part of conformance. The conversion record lists each one, with the reason.

### 3.2 Isolation — two tenants and two facilities, in HTTP form

Generated from the contract: for **every operation** with `x-tenant-scoped: true` and a path parameter,
a principal of tenant B requests tenant A's resource and gets **404 `NOT_FOUND`**, byte-identical to an
unknown id (B-STATUS-2). For lists, A's rows are absent and counts exclude them. The same runs per
facility for `x-facility-accessible` operations, with a bound user of F2 against F1's rows (ADR-124
§ 10, P18-04's 38 cases), and with **403 `FACILITY_ROUTE_REFUSED`** for unmarked routes. The generated
case list is diffed against the Node suite's `@two-tenant` / `@two-facility` markers: a route covered
in Node but missing here is a generator defect.

### 3.3 Permission matrix

For every operation, its `x-permission` (slug and action) is tested from outside: a principal holding
the grant passes, and one lacking it gets 403 `FORBIDDEN`. This also covers the bound ceiling
(P18-03 Matrix B). This replaces, for non-Node engines, ADR-103's in-process `x-permission`-vs-chain
check.

### 3.4 Contract fuzzing — Schemathesis

Schemathesis runs against `contracts/dist/openapi.json` and `BACKEND_URL` with authenticated
principals:
- **positive** cases conform to the response schemas;
- **negative** cases (schema-violating requests) get 400 `VALIDATION_FAILED`, never 500;
- every status and `code` the backend returns is declared on the operation;
- **no 5xx** on any generated input;
- stateful links (create → read → update → delete) where the contract declares `links`.

Its seed is fixed per run, so a failure reproduces.

### 3.5 Behaviour and realtime

- The behaviour checks: one or more tests per `B-*` rule of [`03`](./03-BEHAVIOUR-SPEC.md). Examples:
  envelope shape on every response class, ETag/304, idempotency replays (all four answers),
  refresh-once and rotation, credential endpoints, upload limits, signed-link expiry, the 429 shape and
  `Retry-After`, `/meta` capabilities, audit-row-in-transaction via the audit read.
- The realtime checks of [`05`](./05-REALTIME-ASYNCAPI.md) § 7 (Socket.IO v4 client, isolation, re-check,
  after-commit, adapter interoperability).
- The **named-rule vectors** (`contracts/vectors/`) are run by each engine's **own** unit tests, not by
  this suite, because they test functions, not HTTP. The suite checks their **effects** through the API
  (e.g. a QR in a non-normal form finds the device).

### 3.6 Route inventory

The engine's served operations (from `/meta` capabilities plus a probe of every operation of each
claimed module) must equal the contract's operations for those modules: none missing, none extra (an
undocumented route answers 404, never 200).

## 4. Scoring and the 100% Rule

- A **module** of an engine is **conformant** when every check tagged with that module passes,
  including its isolation, permission, fuzz and behaviour checks. A skipped check counts as failed.
- An **engine** is conformant for a release when every module it claims in `/meta` is conformant.
- The gateway ([`07`](./07-PORTING-PLAYBOOK.md) § 2) may route a module to an engine **only** if that
  engine's latest run on the same contract version is 100% for the module.
- A failing check is never deleted or marked "known failure" to reach 100%. A check that is wrong is
  fixed through a contract change with its own review (`02` § 6).

## 5. CI

| Job | Runs | Blocks |
|---|---|---|
| `contract` | the contract gates (`02` § 5) | everything below |
| `conformance-node` | the full suite against the Node backend on the compose stack | merge, when `backend/`, `contracts/` or `conformance/` changed |
| `conformance-<engine>` | the suite for the modules the engine claims | merge, when that engine, `contracts/` or `conformance/` changed |
| `conformance-gateway` | the suite through the gateway with the production routing table | a routing change |
| nightly | every engine × full suite × both browsers' realtime client versions | opens an issue on failure |

This also closes the gap the web never closed: the live E2E suite **in CI** (A-19). The first Phase 33
job that runs it is its first CI run.

## 6. What the Suite Does Not Prove

- Performance (the k6 scripts of U-06 stay separate).
- The UI (the browser suites stay in `automate/` and run against the frontend, whose backend may be any
  conformant engine).
- Internal properties no client can observe: the append-only triggers as the application role, grants,
  migrations. Those stay in each engine's own live tests, and the database ones are engine-independent
  ([`07`](./07-PORTING-PLAYBOOK.md) § 3).
