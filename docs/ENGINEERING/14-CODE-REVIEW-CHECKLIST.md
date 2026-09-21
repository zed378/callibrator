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
- [ ] every new raw query carries `tenant_id = $n`, **bound**
- [ ] cross-tenant access returns 404, and a two-tenant test proves it — including that a mutation left the row **unchanged**

## Data

- [ ] mutations run in a transaction that writes the audit row
- [ ] optional includes carry `required: false`
- [ ] `$n` placeholders use `bind`, not `replacements`
- [ ] `sequelize` imported by name — not `db` destructured from the models barrel
- [ ] `sessions` attributes written snake_case; everywhere else `isDeleted`, not `is_deleted`
- [ ] no applied migration edited; no recorded migration name changed
- [ ] a new migration verified by inspecting the columns, not the log

## Input and Errors

- [ ] validation covers params, query and body together
- [ ] no unguarded `req.body.x`; a bodyless-request test exists for each body-reading route
- [ ] expected failures throw `AppError` with the right status; invalid transitions are 409 with a state explanation
- [ ] no `catch` returns a default that is not a true answer
- [ ] nothing but the central handler writes an error response

## Types (TypeScript files)

- [ ] no `any`, no `as unknown as`, no `!`, no `@ts-ignore`
- [ ] exported functions declare return types
- [ ] new state values extend the union and every exhaustive `switch` still compiles
- [ ] no `process.env` outside `src/config/`
- [ ] the ratchet did not go up

## Tests

- [ ] the tests would fail without the change — checked, not assumed
- [ ] mocks expose only what the real dependency exposes
- [ ] no assertion copied from an implementation detail; behaviour asserted instead
- [ ] backend gate still at 100%, suite named with its count in the PR

## Operations

- [ ] a new environment variable is in `.env.example` **and** `docs/BACKEND/11-CONFIGURATION.md`
- [ ] no secret, token or signed URL in a log line
- [ ] no new `console.*`
- [ ] anything that outlives the request is on RabbitMQ, not a timer
- [ ] the image builds and boots; `/health` 200

## Documentation

- [ ] every document the change contradicts is updated in this PR
- [ ] a deviation from `docs/` has an ADR
- [ ] `MEMORY/records/` entry, index line, changelog line, `TASKS/PROGRESS.md` — if the task is finished
- [ ] nothing documented that was not checked against the code
