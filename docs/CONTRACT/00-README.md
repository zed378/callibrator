# CONTRACT/ — The Backend-Agnostic Contract (TARGET)

> **Everything in this folder is TARGET. Nothing here is built.** As of 2026-10-08 there is **no
> `contracts/` folder** and **no conformance suite**. The HTTP contract today is **generated
> code-first** from the Express routes' Zod schemas (ADR-103) into `backend/openapi.json`. The realtime
> events are undocumented. Behaviour (the envelope, 404-not-403, 409 explanations, refresh-once,
> cookies, uploads) lives in the Node code and in prose documents. Where a document says "the contract
> says X", read "the contract, once written, will say X". Writing a target as fact is PR-4 (`CLAUDE.md`).

**Decision record:** **ADR-136** (`MEMORY/DECISIONS.md`): the contract is written first, in a
language-neutral `contracts/` folder; the conformance suite gates every backend; ports proceed module
by module behind a gateway. It **supersedes ADR-103's code-first rule** and keeps ADR-103's CI gates
re-pointed at `contracts/`. It **amends ADR-089**: the Go engine is built module by module against
`contracts/`. **Origin:** the owner's brainstorm and decisions of 2026-10-08.
**Plan:** [Phase 32](../../TASKS/PHASE-32-CONTRACT-FIRST-FOUNDATION.md) (contract-first foundation,
behaviour spec, error codes), [Phase 33](../../TASKS/PHASE-33-CONFORMANCE-SUITE.md) (the conformance
suite and CI per backend), [Phase 34](../../TASKS/PHASE-34-PORTABILITY.md) (portability: SQL
migrations, JWKS, `/meta`, gateway, AsyncAPI). All three run after Phase 31. The shared packages and
mobile (Phase 35+) follow them, and Phase 999 (Go) is built on them.

---

## The Owner's Goal, in One Paragraph

The Next.js frontend and the mobile app must **never need a version per backend**: not one for Node,
one for Go, or one for any language a future port chooses. A port to another language must **not need
a new frontend**. Clients therefore bind to a **contract** that no backend owns. Every backend proves
it honours the contract by passing **one black-box conformance suite** at 100%. A port replaces the
Node backend **one module at a time** behind a gateway, on the same database, while users keep working.

## Documents

| # | Document | What it decides |
|---|---|---|
| 00 | this file | index, status, reading order |
| 01 | [`01-ARCHITECTURE.md`](./01-ARCHITECTURE.md) | the layers (contract, generators, backends, clients, gateway, conformance), what is in `contracts/`, its relation to `packages/contracts`, what may and may not be backend-specific |
| 02 | [`02-CONTRACT-FIRST-WORKFLOW.md`](./02-CONTRACT-FIRST-WORKFLOW.md) | how a change is made: edit `contracts/` → generate → implement → conform. Node **generates Zod from OpenAPI** (decided, with an equivalence check during the migration). How the current code-first document becomes the v1 baseline. ADR-103's gates re-pointed |
| 03 | [`03-BEHAVIOUR-SPEC.md`](./03-BEHAVIOUR-SPEC.md) | the normative behaviour OpenAPI cannot express: envelope, status codes, 404-not-403, 409, error `code`, auth and session (cookie and bearer), CSRF, refresh-once, pagination, sorting, ETag, idempotency, uploads and downloads, streaming, rate limits, time, decimals, versioning |
| 04 | [`04-ERROR-CODES.md`](./04-ERROR-CODES.md) | the error-code catalogue's conventions: the `code` field, naming, the registry file, i18n keys, stability, which codes exist already |
| 05 | [`05-REALTIME-ASYNCAPI.md`](./05-REALTIME-ASYNCAPI.md) | Socket.IO kept and described in AsyncAPI 3: handshake, rooms, the as-built events, isolation rules, the v4 protocol compatibility a port must prove |
| 06 | [`06-CONFORMANCE-SUITE.md`](./06-CONFORMANCE-SUITE.md) | the black-box suite against any `BACKEND_URL`: the live E2E specs, two-tenant and two-facility 404s in HTTP form, contract fuzzing (Schemathesis), behaviour checks, realtime checks, SQL fixtures, per-module scoring, CI per backend |
| 07 | [`07-PORTING-PLAYBOOK.md`](./07-PORTING-PLAYBOOK.md) | the strangler: the gateway by module, one database, plain-SQL migrations, JWKS-shared signing keys, `GET /api/v1/meta` capabilities, tenant-isolation parity, the RLS question, the order of modules, rollback |
| 90 | [`90-CONVENTIONS.md`](./90-CONVENTIONS.md) | file layout of `contracts/`, naming of operations, schemas, events, codes and rules; extensions; review rules; versioning; what a PR must carry |

## What This Changes for Other Documents

| Document | Change |
|---|---|
| ADR-103 / `docs/API/00`, `14` | the source of truth moves from the Zod schemas in `backend/` to `contracts/`. Zod becomes **generated**, and the gates stay ([`02`](./02-CONTRACT-FIRST-WORKFLOW.md) § 5) |
| ADR-089 / `docs/ARCHITECTURE/11`, `docs/BACKEND/12` / `TASKS/PHASE-999` | Go is no longer a "full port, then parity diff against TS". It is built **module by module against `contracts/`**, gated by the conformance suite, behind the gateway ([`07`](./07-PORTING-PLAYBOOK.md)) |
| `docs/SHARED/`, `docs/MOBILE/` (ADR-134, ADR-135) | the clients were already bound to the OpenAPI document. Now that document is `contracts/`. There is **one** mobile and shared-package plan. Only the backend-for-mobile tasks have a Node variant and a Go variant (`TASKS/PHASE-36-…` Node, `TASKS/PHASE-1000-MOBILE-BACKEND-GO.md` Go) |
| `MEMORY/specs/P19-02`, `P19-08` | they put conflict and scope-loss codes in `data.code`. As built (`auth.middleware.ts`, `response.util.ts#error` with `extra`), the code is a **top-level** `code`. The contract keeps the **top-level** `code` ([`04`](./04-ERROR-CODES.md) § 2) and reads the P19 specs' `data.code` as that field |

## Reading Order

1. `01` → `03` (the behaviour every backend owes) → `06` (how it is proved).
2. Before changing an API: `02`, `04`, `90`.
3. Before porting a module: `07`, then `docs/SECURITY/05` (mandatory), then the module's conformance score.
