# 01 — Architecture of the Backend-Agnostic Contract (TARGET)

> **TARGET — nothing here is built.** Decision: ADR-136.

---

## 1. The Layers

```
                         contracts/   ← the single source of truth, no backend owns it
        ┌───────────────────┬───────────────┬──────────────────┬──────────────────────┐
        │ openapi/ (3.1)    │ asyncapi/ (3) │ behaviour/       │ errors/ · rules/ ·   │
        │ HTTP operations,  │ Socket.IO     │ normative prose: │ vectors/             │
        │ schemas, x-ext.   │ events, rooms │ envelope, auth,  │ codes, named rules,  │
        │                   │               │ paging, uploads  │ golden vectors       │
        └─────────┬─────────┴───────┬───────┴────────┬─────────┴──────────┬───────────┘
                  │ generators      │                │                    │
     ┌────────────┼─────────────────┼────────────────┼────────────────────┼─────────────┐
     ▼            ▼                 ▼                ▼                    ▼             ▼
 Node backend   Go backend     any future port   packages/api-client   packages/i18n  conformance/
 (Zod generated (validators    (its validators   (types + client,      (code → message (black-box,
  + refinements) generated)     generated)        web + mobile)         keys)           any BACKEND_URL)
     │            │                 │
     └────────────┴──── gateway (routes /api/v1/<module>/… per module to one engine) ────┐
                                                                                         ▼
                                              one PostgreSQL 18 database, plain-SQL migrations
```

| Layer | Owns | Never owns |
|---|---|---|
| **`contracts/`** | what a client may send and will receive; behaviour rules; error codes; events; golden vectors for shared rules | any implementation, any language-specific type |
| **Generators** | turning the contract into each language's validators and types, and each client's client | decisions — a generator that needs a choice the contract does not express is a contract gap |
| **Backends** | implementations; tenant isolation; persistence; side effects | the shape of the contract — a backend never "documents what it does" any more |
| **Gateway** | which engine serves which module; nothing else | authentication, authorisation, transformation of bodies |
| **Clients** (web, mobile, PWA) | rendering; calling through the generated client | any knowledge of which engine answered |
| **Conformance suite** | the proof | being generated from any backend's code (that would test consistency, not correctness — `CLAUDE.md` § Evidence) |

## 2. What Is in `contracts/` (target layout; details in `90`)

| Path | Content | Format |
|---|---|---|
| `contracts/openapi/openapi.yaml` + `paths/<module>/*.yaml`, `components/**` | every HTTP operation of `/api/v1` (and `/native/api/v1` as the same paths, ADR-134), split per module, bundled to `contracts/dist/openapi.json` | OpenAPI **3.1** (JSON Schema 2020-12) |
| `contracts/asyncapi/asyncapi.yaml` | the Socket.IO namespace, handshake, rooms, events and payloads ([`05`](./05-REALTIME-ASYNCAPI.md)) | AsyncAPI **3.0** |
| `contracts/behaviour/*.md` | the normative behaviour spec ([`03`](./03-BEHAVIOUR-SPEC.md) is its draft; once built, `03` points here) | Markdown with numbered, citable rules (`B-ENV-1`, `B-AUTH-4` …) |
| `contracts/errors/codes.yaml` | the error-code catalogue ([`04`](./04-ERROR-CODES.md)) | YAML, schema-validated |
| `contracts/rules/*.yaml` | **named rules** that JSON Schema cannot express (cross-field refinements, computed values: `normaliseQrCode`, `computeIpmDue`, `ipm-report-v1` hash, the measured-value parser, `missingRequiredItems`, the scope fingerprint) — id, statement, inputs, outputs | YAML + prose |
| `contracts/vectors/<rule>.json` | **golden vectors** for each named rule: input → expected output. Every implementation in every language runs them | JSON |
| `contracts/fixtures/*.sql` | the conformance suite's seed data (two tenants, two facilities, roles, a catalogue) — plain SQL, loadable by any engine's test harness | SQL |
| `contracts/CHANGELOG.md`, `contracts/VERSION` | the contract's own version (`1.<minor>.<patch>`, [`03`](./03-BEHAVIOUR-SPEC.md) § 15) | text |

## 3. `contracts/` and `packages/contracts`

They are different things with similar names, so the rule is stated once:

- **`contracts/`** (repository root) is **language-neutral source**. No TypeScript in it.
- **`packages/contracts`** (`@callibrator/contracts`, as built, ADR-097) is the **TypeScript
  consumer**. It holds the **generated** Zod schemas and types for TypeScript code (backend and
  clients), plus the TypeScript **implementations** of the named rules, which must pass
  `contracts/vectors/`. Its hand-written request schemas (ADR-097) are replaced by generated ones
  module by module ([`02`](./02-CONTRACT-FIRST-WORKFLOW.md) § 4).
- A Go port has its own consumer (`backend-go/internal/contract/`, generated) and its own rule
  implementations, passing the same vectors.

## 4. What May Be Backend-Specific, and What May Not

| May differ between engines | Must be identical (the contract) |
|---|---|
| language, framework, ORM, internal module layout, logging format, process model | paths, methods, request and response shapes, status codes, error `code`s, headers the contract names |
| how tenant isolation is implemented (hooks, query builder, RLS — [`07`](./07-PORTING-PLAYBOOK.md) § 6) | **that** it holds: the two-tenant and two-facility suites, 404 for not-yours |
| performance characteristics within the documented limits | rate-limit budgets and their 429 shape; page-size caps; upload limits |
| internal error messages in logs | the client-visible `message` **may** differ in wording; the `code` may not. Clients translate the `code` ([`04`](./04-ERROR-CODES.md)) |
| how jobs and schedulers run | the side effects the contract documents (an audit row exists; a notification is sent) |

## 5. Why Not Just "Port and Diff Against Node" (the old Phase 999 plan)

The earlier plan (ADR-089, `docs/BACKEND/12` § 8) made the TypeScript backend the specification:
"the same request to both backends returns byte-equivalent responses". That makes every Node defect a
requirement, keeps the contract implicit, and works only while a Node backend runs beside the port.
The contract-first design keeps the parity diff as **one** tool, used where the contract is silent.
The specification is `contracts/` plus the conformance suite, which runs against **one** backend at a
time and needs no reference engine.
