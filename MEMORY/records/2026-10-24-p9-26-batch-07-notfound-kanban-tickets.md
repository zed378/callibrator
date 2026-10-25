# P9-26 batch 7: notFound, kanban.route, tickets.route — .js to .ts, no assertion changed

**Date:** 2026-10-24 · **Card:** P9-26 · **Status:** DONE (batch 7) · **Spec refs:** ADR-087 Amendment 1 (ratchet), ADR-109 §5 (P9-26 rules)

## Hook

P9-26 converts a `.js` test when someone already edits it. The three files converted here were all touched since 2026-10-01 and still `.js`, their modules are already `.ts`, and none needs a live stack: the 404 middleware unit test and the kanban + tickets router-shape tests. Conversion changes imports and types only: same case names, same count, same pass/fail.

## What changed

| | |
|---|---|
| `backend/src/tests/middlewares/notFound.test.js` → `.test.ts` | `require` → side-effect `import` for `response.util` + `require` with a `Handler = (req: unknown, res: unknown) => void` type (as the a342 envelope suite does); plain `{ status: jest.fn(), json: jest.fn() }` mock objects — no `Response` type, so `unbound-method` and `consistent-type-assertions` stay quiet without a disable |
| `backend/src/tests/routes/kanban.route.test.js` → `.test.ts` | `require` → `require` + `KanbanRouter`/`KanbanRouteLayer` interfaces (the router is `export =`, so no `import` — ADR-087 Am. 15), as batch 5's admin.route conversion does |
| `backend/src/tests/routes/tickets.route.test.js` → `.test.ts` | same shape as kanban: `TicketRouter`/`TicketRouteLayer` interfaces over `require` |
| ratchet | floor 682 → 679 (the 3 batch-7 files; the `.js` files deleted) |

No assertion changed: notFound 2 cases, kanban 5 cases, tickets 5 cases — 12 total, same names, same expectations. Two mid-conversion failures, both type-system only, both fixed without touching an assertion: (1) `import { notFound }` + `notFound({}, res)` tripped `unbound-method` (the imported fn reference) and `{} as Request` tripped `consistent-type-assertions` (`objectLiteralTypeAssertions: never`); (2) the namespace-call rewrite kept the `unbound-method` error on `res.status` inside `expect()` — resolved by dropping the `Response` type and using plain mock objects like the a342 suite.

## Tests

- `notFound.test.ts`: 2/2 — 404 status + json called, next not called.
- `kanban.route.test.ts`: 5/5 — router shape, registered routes, multiple handlers, middleware-or-routes, valid methods.
- `tickets.route.test.ts`: 5/5 — same five shape checks.
- `npx eslint` (the three files, `--fix`): clean.
- `npm run typecheck`: clean.

- **Not run:** the full suite — three test files converted, proved by their own suites (the 100% coverage gate fails on a scoped run by design; the suites themselves are 12/12 green).

## Definition of Done (P9-26 rules)

- [x] same case names, same count, same pass/fail
- [x] the ratchet floor lowered in the same change (the `.js` files deleted)
- [x] no new `.js` (the new files are `.ts`)

## Files

- `backend/src/tests/middlewares/notFound.test.ts` (new), `.test.js` (deleted)
- `backend/src/tests/routes/kanban.route.test.ts` (new), `.test.js` (deleted)
- `backend/src/tests/routes/tickets.route.test.ts` (new), `.test.js` (deleted)
- `backend/.ts-ratchet.json` (floor 682 → 679)
- This record
