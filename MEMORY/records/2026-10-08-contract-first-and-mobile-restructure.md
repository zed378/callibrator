# The backend-agnostic contract planned (ADR-136): contract-first `contracts/`, the conformance suite, module-by-module porting; the Go mobile phases restructured

**Date:** 2026-10-08 · **Item:** the owner's brainstorm and decisions of 2026-10-08 (all recommended options), relayed by the coordinator · **Decision:** ADR-136 (Accepted as the plan, not built). It supersedes ADR-103's code-first rule (gates kept) and amends ADR-089 and ADR-135 § 13 · **Base commit:** `9e4663b` (working tree, nothing committed) · **Kind:** documentation and phase files only. No code, configuration or build change. Nothing was run, staged or committed. The shared boards were re-read before each edit, only this work's rows were touched, and CRLF endings were kept (`PROGRESS`, `DECISIONS`, `CHANGELOG`, `MEMORY-INDEX`).

## What was asked

A backend-agnostic frontend contract, so that the Next.js frontend and the mobile app never need a version per backend and a port to any language needs no new frontend. Implementation comes after Phase 31; mobile comes after this work. The owner's decisions:
1. contract-first `contracts/` (OpenAPI 3.1, AsyncAPI 3, a behaviour spec), with every backend generating its validators. For Node: generate Zod or prove equivalence — choose and justify;
2. Socket.IO kept and described in AsyncAPI, with v4 compatibility proved by each port;
3. module-by-module porting behind a gateway on one database, with plain-SQL migrations, JWKS, `/meta`, and a black-box conformance suite where 100% means done;
4. one contract version (`v1` additive, `/v2` for breaks), with stable error `code`s;
5. one mobile plan.

Deliverables: `docs/CONTRACT/`, ADR-136, Phases 32–34, the Phase 999 update, the restructure of the Go mobile phases, the ID fixes, and the boards.

## Verified as built (2026-10-08, read only)

- `frontend/src/api/typed.ts` (openapi-fetch + openapi-typescript); 56 service files; the Next proxy `frontend/src/app/api/v1/[...path]`.
- `backend/package.json` `openapi:generate|check|lint|breaking` (ADR-103).
- 98 Umzug migrations (`config/migrator.ts`, table `schema_migrations`) plus `db.sync()` at boot (`index.ts`).
- `utils/jwt.util.ts`: `JWT_ALGORITHM` defaults to HS256.
- `response.util.ts#error` puts `code` **top-level** through `extra`; only `PASSWORD_CHANGE_REQUIRED` and `MFA_ENROLMENT_REQUIRED` use it.
- `config/socket.ts`: socket.io ^4.8.4 with the Redis adapter. Rooms `tenant_`, `user_`, `super_admins`, `board_`. Client events `kanban:join` (with an ack) and `kanban:leave`. Server events `new_notification` plus 18 `kanban:*` events (`emitToBoard` callers).
- `backend/src/tests/e2e`: 57 spec files.

## Outputs

| Output | Content |
|---|---|
| `docs/CONTRACT/00-README.md` … `07-PORTING-PLAYBOOK.md`, `90-CONVENTIONS.md` | the layers and the `contracts/` layout (vs `packages/contracts`); the workflow and the v1 bootstrap from the as-built document (oasdiff = 0 both ways); **Node generates Zod** (with a shrink-only equivalence check during the migration); the gates re-pointed; the behaviour spec (`B-ENV`, `B-STATUS`, `B-AUTH`, `B-CSRF`, `B-PAGE`, `B-ETAG`, `B-IDEM`, `B-FILE`, `B-STREAM`, `B-RATE`, `B-DATA`, `B-ISO`, `B-META`, `B-VER`); the error-code registry and conventions (top-level `code`); Socket.IO in AsyncAPI with the event inventory and the six v4-compatibility checks; the conformance suite's five parts, scoring and CI; the strangler (gateway generated from `x-module`, SQL migrations with golang-migrate recommended and `db.sync()` retired, ES256 + internal JWKS with the issuer as the `auth`-module owner, `/meta`, isolation parity, the RLS recommendation, the module order) |
| `TASKS/PHASE-32-CONTRACT-FIRST-FOUNDATION.md` | 10 cards, BLOCKED until P31-04 |
| `TASKS/PHASE-33-CONFORMANCE-SUITE.md` | 10 cards (the Node job is the live suite's first CI run — A-19) |
| `TASKS/PHASE-34-PORTABILITY.md` | 9 cards (P34-07 RLS waits on the owner's Q-C1; P34-08 is the rehearsal with a second Node instance) |
| `TASKS/PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md` | prerequisite 3 (Phases 32 … 34) and a re-plan block: module by module against `contracts/`, conformance at 100%, P999-18/19 superseded, P999-20 = the gateway |
| `TASKS/PHASE-1000-MOBILE-BACKEND-GO.md` | the restructured Go mobile work (was `PHASE-1001`), 16 cards; `PHASE-1000-SHARED-PACKAGES-GO` and `PHASE-1002-MOBILE-APP-GO` deleted (both had been written earlier the same day and never committed) |
| `MEMORY/DECISIONS.md` | ADR-136; ADR-089 and ADR-103 status notes; ADR-135 § 13 rewritten, § 14 ids, implications, Q-M2 … Q-M5 answers |
| `docs/MOBILE/00`, `08`, `11` | one-plan section; ids per the other agent's map; the conformance wording |
| Boards | `TASKS/README.md` (rows 32–34; one row 1000), `TASKS/PROGRESS.md` (a "Phases 32 … 34" section before Phase 35; the Go section collapsed to Phase 1000), `TASKS/BACKLOG.md` D-11, `docs/README.md` (CONTRACT/; MOBILE plans) |

## Decisions and their reasons (in ADR-136)

- **Generate, not prove equivalence.** One copy of every shape. Equivalence proving leaves refinements and defaults to drift unseen, which is ADR-103's own P6-08 lesson.
- **The top-level `code`**, matching the as-built position. The `data.code` wording of P19-02/P19-08 is read as this field; their owners align the specs.
- **ES256 + an internal session JWKS.** Sharing an HS256 secret would let every engine mint sessions.
- **A rehearsal with a second Node instance** proves the gateway, JWKS verification and `/meta` before any new language exists.

## Deviations

| Document | Was | Now | ADR |
|---|---|---|---|
| ADR-103 § 1 | Zod is the source of truth (code-first) | `contracts/` is; Zod is generated; the gates stay | ADR-136 |
| ADR-089 / Phase 999 | full Go port, proved by byte parity with TS; per-backend frontend adapter | module by module against `contracts/`, conformance at 100%; no per-backend adapter | ADR-136 |
| ADR-135 § 13 | Go-variant phases for the packages, backend and app | one mobile plan; only the backend for mobile has a Go variant | ADR-136 |
| `MEMORY/specs/P19-02`, `P19-08` | `data.code` | top-level `code` (to be aligned by the spec owners — **not edited here**) | ADR-136 |

## Not done / not determined

- `docs/API/00`, `14`, `docs/ARCHITECTURE/11` and `docs/BACKEND/12` are not edited. P32-06 and Phase 999's first card add their banners; ADR-136 is the authority until then.
- Nothing is built or verified. The generator, the migration runner and the Schemathesis version are each chosen by their card.

## Owner questions

- **Q-C1:** RLS as a second layer. Recommendation: yes, fail-closed, on the evidence chain first, before a second engine writes.
- **Q-C2:** a module moves only when both engines are at 100%. Recommendation: yes.
- **Q-C3:** how long v1 lives beside a v2. Recommendation: ≥ 90 days, and while any supported app uses it.
- Still open from ADR-135: Q-M1, Q-M6.
