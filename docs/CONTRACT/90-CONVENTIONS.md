# 90 — Conventions for `contracts/` and `conformance/` (TARGET)

> **TARGET — nothing here is built.** These rules are set up by Phase 32 (contract) and Phase 33
> (conformance) as lint rules and gates, not as hopes.

---

## 1. Layout

```
contracts/
├── VERSION                      1.<minor>.<patch>  (B-VER-3)
├── CHANGELOG.md                 one entry per change: additive / docs; names the PR and the card
├── .spectral.yaml               lint rules (02 § 5)
├── openapi/
│   ├── openapi.yaml             root: info, servers ("/"), security schemes, tags, $refs to paths
│   ├── paths/<module>/<resource>.yaml
│   └── components/{schemas,parameters,responses,headers}/<area>/*.yaml
├── asyncapi/asyncapi.yaml       05
├── behaviour/<area>.md          03 (B-ENV, B-STATUS, B-AUTH …)
├── errors/codes.yaml            04
├── rules/<rule-id>.yaml         named rules (x-rule)
├── vectors/<rule-id>.json       golden vectors
├── fixtures/*.sql               conformance seed
└── dist/                        generated bundles (openapi.json, asyncapi.json) — committed, checked stale
conformance/
├── functional/<module>/*.test.ts
├── isolation/                   generated two-tenant / two-facility cases
├── permissions/                 generated permission matrix
├── behaviour/<area>.test.ts
├── realtime/*.test.ts
├── fuzz/schemathesis.toml
└── harness/                     seed loader, sign-in helpers, scoring
```

## 2. Naming

| Thing | Convention | Example |
|---|---|---|
| `operationId` | `<module>.<verb><Resource>` camelCase, unique, never reused | `ipm.submitSession` |
| Paths | kebab-case resources, `{camelCaseParam}` named after the resource | `/ipm/sessions/{sessionId}/submit` |
| Schemas | PascalCase, suffixed by role: `…Create`, `…Update`, `…Summary`, `…Detail`, `…Query` | `IpmSessionCreate` |
| Fields | camelCase (B-DATA-4) | `clientFacilityId` |
| Error codes | `UPPER_SNAKE`, area-prefixed (`04` § 4) | `IPM_NOT_DRAFT` |
| Events | `<area>:<resource>:<pastTenseVerb>` for server events, `<area>:<verb>` for client commands | `kanban:card:moved`, `kanban:join` |
| Named rules | kebab-case with a version suffix | `qr-normalise-v1`, `ipm-report-hash-v1` |
| Behaviour rules | `B-<AREA>-<n>`, never renumbered | `B-AUTH-4` |

## 3. Required Extensions on Every Operation

`x-module` (the gateway key), `x-permission` (slug + action, or `public`), `x-tenant-scoped`,
`x-facility-accessible` (ADR-124 Am. 1), `x-audited`, `x-rate-limit`, `x-error-codes`,
`x-credential-endpoint` (when true), `x-idempotent` / `x-etag` / `x-upload` (when they apply), `x-rule` on
schemas and operations that depend on a named rule. Spectral fails an operation that lacks a required
one.

## 4. Change Rules

- **Additive only in v1** (B-VER-1), except the **CD-1** class — a security/validation tightening of input
  that was never valid, with a changelog line, an ADR reference, the minimum-app-version announcement and
  a reviewed allow-list entry for `openapi:breaking`. The breaking gate refuses anything else, and "but nobody uses it" is
  not an exception.
- Every change bumps `VERSION` (minor or patch) and adds a `CHANGELOG.md` line.
- A change to a named rule is a **new rule id** (`…-v2`) with its own vectors. The old one stays for data
  already computed with it (as the `ipm-report-v1` hash scheme does).
- A new error code is registered with both languages' messages in the same PR.
- A contract PR is reviewed by a client owner (`02` § 6).
- Generated files are never edited by hand. `contract:check` fails on a stale or edited generation.

## 5. Conformance Rules

- A check names the rule(s) it proves (`@rule B-STATUS-2`) and its module (`@module ipm`).
- No imports from `backend/`, `backend-go/` or any engine. A lint rule refuses them.
- No sleeps for ordering: use the API's own state (poll with a timeout), as the live suites do.
- A check is never skipped to reach 100% (`06` § 4). A flaky check is fixed or removed through review,
  with the reason recorded.
- Synthetic data only: no upstream value enters `contracts/fixtures/` (the privacy rule of every upstream
  card).

## 6. Evidence

As everywhere in this repository: **name the run**. A record of a port says which engine, which module,
which contract version and which conformance run id scored 100%. "Conformance green" without the run is
not evidence.
