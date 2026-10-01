# 14 — Code Review Checklist

Copy into the PR description and tick. An unticked item needs a reason written next to it. Every line exists because its absence has shipped a defect here.

---

## Scope

- [ ] one purpose — not a conversion **and** a fix, not a refactor **and** a behaviour change
- [ ] task id in the branch, the title and the commit subject

## Authorisation and Tenancy

- [ ] every new or changed route has a permission gate (`dynamicAccess` with a real menu slug, or `rbac`)
- [ ] routes that configure storage, webhooks or domains are `denyApiKey` and admin-only
- [ ] no `tenantId` read from body, query or header
- [ ] any lookup of a model **without** a tenant attribute (e.g. `Tenant`) by a request id has an explicit ownership check
- [ ] every new raw query carries `tenant_id = $n`, **bound**; in a `.ts` file it goes through `sql()` (`utils/sql.util.ts`, P9-07) — no direct `sequelize.query` / `db.query`
- [ ] cross-tenant access returns 404, and a two-tenant test proves it — including that a mutation left the row **unchanged**; a new `:id` route's test uses `twoTenantSuite` + `memoryDb` and carries its `@two-tenant` marker (`twoTenantRoutes.guard` green)
- [ ] `routePermissionGuard.p604` green; a new exemption in `constants/routeGateExemptions.ts` has a kind and a reason
- [ ] a new `skipTenantScope` has a comment saying why; a new `isSystemTask` comes only from `jobContext.util` with a listed reason

## Data

- [ ] mutations run in a transaction that writes the audit row
- [ ] optional includes carry `required: false`
- [ ] `$n` placeholders use `bind`, not `replacements`
- [ ] `sequelize` imported by name — not `db` destructured from the models barrel
- [ ] `sessions` attributes written snake_case; everywhere else `isDeleted`, not `is_deleted`
- [ ] no applied migration edited; no recorded migration name changed
- [ ] a new migration verified by inspecting the columns, not the log

## Input and Errors

- [ ] validation covers params, query and body together: `validate(schema, { from: [...] })` with the sources declared (a path parameter wins); `validate()` is the only middleware form — no `schema.parse` / `.safeParse` passed to a router (`schemaAsMiddleware.p911`)
- [ ] a `.ts` handler reads `validated(req, schema)`, not `req.body` and not `req.validated as X`
- [ ] a Zod schema has no `z.any()`, `.passthrough()`, `.loose()` or `z.coerce`; conversions come from `validators/fields.ts`
- [ ] a changed validator's contract suite (`tests/contracts/validation/`) passes **unchanged**, or the literal change is recorded as a contract change
- [ ] no unguarded `req.body.x`; a bodyless-request test exists for each body-reading route
- [ ] expected failures throw `AppError` with the right status; invalid transitions are 409 with a state explanation
- [ ] no `catch` returns a default that is not a true answer
- [ ] nothing but the central handler writes an error response

## Types (TypeScript files)

- [ ] no `any`, no `as unknown as`, no `!`, no `@ts-ignore`; every `@ts-expect-error` and `eslint-disable` carries its reason
- [ ] exported functions declare return types
- [ ] new state values extend the union and every exhaustive `switch` still compiles
- [ ] no `process.env` outside `src/config/` — `env()` / `envOr()` / `isProduction()` from `config/env.ts`
- [ ] no brand assertion (`as TenantId`) outside `src/types/ids.ts`; a shared type lives in `src/types/`
- [ ] every new backend file, **tests included**, is `.ts`; `npm run ratchet` passes and its lowered floor (`backend/.ts-ratchet.json`) is in the same commit
- [ ] `npm run typecheck` (TypeScript 7, never bare `npx tsc`) passes — jest checks no types
- [ ] **a conversion** is leaf-first (`npm run build:dist` passes), changes no behaviour, and names its identity check (count, and every accepted difference); tenant-isolation code also names its four gates; the P9-00 E2E set passes against an image built from the branch
- [ ] a source-scanning guard the change touches reads `.ts`, and a new or changed guard has a recorded bite proof

## Tests

- [ ] the tests would fail without the change — checked, not assumed
- [ ] mocks expose only what the real dependency exposes
- [ ] no assertion copied from an implementation detail; behaviour asserted instead
- [ ] backend gate still at 100% (of the six measured layers — `docs/BACKEND/09-TESTING.md`), suite named with its count in the PR
- [ ] a test of a grant, trigger or isolation property on PostgreSQL runs as `callibrator_app`, not the owner, and names the variable that enables it
- [ ] `node scripts/ci/eslint-ratchet.js` reports 0 errors, and `npx eslint` is clean on every changed file outside `backend/src/` too
- [ ] a new `istanbul ignore` is reviewed like a new `eslint-disable`: it carries `-- <reason>` saying why the code is kept, and the ceiling in `istanbulIgnore.a32.test.js` did not go up

## Operations

- [ ] a new environment variable is in `.env.example` **and** `docs/BACKEND/11-CONFIGURATION.md`
- [ ] no secret, token or signed URL in a log line
- [ ] no new `console.*` (`noConsole.a42`)
- [ ] a new command line or script runs backend source through `tsx` (or `--import tsx`), never plain `node`
- [ ] frontend: a new page renders inside the CSP (no inline `<script>`, a `<style>` element only with the nonce, no third-party image origin); it has one `<main>` and one `<h1>`; an icon-only control is named after its object; a new colour uses a theme token (ADR-071, ADR-090)
- [ ] anything that outlives the request is on RabbitMQ, not a timer
- [ ] the image builds and boots; `/health` 200

## Documentation

- [ ] every document the change contradicts is updated in this PR
- [ ] a deviation from `docs/` has an ADR
- [ ] `MEMORY/records/` entry, index line, changelog line, `TASKS/PROGRESS.md` — if the task is finished
- [ ] nothing documented that was not checked against the code
