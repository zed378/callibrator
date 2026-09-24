# 10 — Frontend Testing

Jest 30 · Testing Library · jsdom · axe-core. Coverage gate: **target 70%; enforced today at 41/35/34/41** (statements/branches/functions/lines) — see [§ Coverage gate](#coverage-gate). *(Amended 2026-09-24, F-03/F-04, ADR-PENDING-fe.)*

Overall strategy: [`../TESTING/00-TEST-STRATEGY.md`](../TESTING/00-TEST-STRATEGY.md).

---

## The Lesson This Suite Was Built From

**3,863 tests passed while 13 endpoints were broken.**

Frontend services had been written against endpoints that did not exist, and their tests mocked the fabrication. Every test agreed with every other test, and none of them agreed with the server.

> A mock test proves the client calls what the developer believed.
> Only a live call proves the endpoint exists and answers that way.

Both layers are required. Neither substitutes for the other.

## Contract Tests — 51 services, 51 tests

`src/api/services/<domain>.service.test.ts`, one beside every service.

Each asserts:

| | |
|---|---|
| The **exact** path | including oddities |
| The HTTP method | several endpoints use `PATCH` where `PUT` is expected |
| The payload shape | |
| The envelope unwrap | rows from `data`, `meta` as a top-level sibling |
| The fallbacks | `null` unwraps to `[]`, not `null` |

### They document reality, not intent

Several assert shapes that look wrong and are correct:

```ts
expect(path).toBe("/menu-groups/menu-groups/admin");   // a real doubled path
expect(method).toBe("PATCH");                           // stock update, not PUT
expect(path).toBe("/warehouses/locations");             // flat, not nested
expect(path).toBe("/users/delete?userId=…");            // id in the query string
```

A test that asserts what the API *should* do is a wish. These assert what it does.

## Component Tests

`__tests__/` beside the component, or `<name>.test.tsx`.

Test behaviour, not implementation:

```tsx
// ✗ implementation
expect(wrapper.state.isOpen).toBe(true);

// ✓ behaviour
expect(screen.getByRole("dialog")).toBeInTheDocument();
```

Query by role and accessible name. A test that queries by `data-testid` everywhere is a test that would still pass if the component were unusable with a keyboard.

### The three-state assertion

Every list component must have three tests, and this is the pair that matters:

```tsx
it("renders ErrorState when the request fails", ...)   // ← not EmptyState
it("renders EmptyState when the list is genuinely empty", ...)
it("renders rows when data arrives", ...)
```

Rendering an empty list on failure is a lie about a compliance figure ([`08-ERROR-BOUNDARIES.md`](./08-ERROR-BOUNDARIES.md)). These two tests are easy to write as one that passes for the wrong reason — assert the **component**, not merely the absence of rows.

## Store Tests

`authStore.test.ts`, `userStore.test.ts`, `src/stores/__tests__/`.

| Assertion |
|---|
| initial state |
| each action's effect |
| **cleared on logout** — a store still holding a user after logout is a real leak |
| **cleared on tenant switch** — otherwise a super-admin sees the previous tenant's cached rows |

The tenant-switch case is a **cross-tenant leak in the browser**, and no backend IDOR test will find it.

## RBAC Tests

| Assertion |
|---|
| the sidebar renders exactly the granted menu groups, per role |
| an unauthorised item is **absent from the DOM** |
| a route reached without permission shows `AccessDeniedModal` |
| a 403 triggers a menu refetch |
| a per-user override changes the rendered menu |

**"Absent from the DOM", not "not visible".** `toBeVisible()` passing is not the same as the element not existing, and that distinction is the entire design ([`05-RBAC-IN-UI.md`](./05-RBAC-IN-UI.md)).

```tsx
expect(screen.queryByText("Billing")).not.toBeInTheDocument();   // ✓
expect(screen.getByText("Billing")).not.toBeVisible();            // ✗
```

## Accessibility Tests

`axe` in the component suite: `axe-core` is a devDependency and
`src/tests/a11y/axe.ts` (`axeViolations(container)`) runs it on the rendered DOM.
Colour contrast and page-level rules (landmarks, one `<h1>`) are off there —
jsdom has no layout, and a lone component has no page; they belong to the
browser suite. First users: `src/components/ui/a11y.f12.test.tsx` (Input,
Textarea, FormField, Select, Dialog, ConfirmDialog, AccessDeniedModal) and
`ErrorState.f07.test.tsx`. *(F-12, 2026-09-24.)* Plus assertions that automated tools cannot make:

| Assertion |
|---|
| every form control has an accessible name |
| errors are linked via `aria-describedby` |
| focus is trapped in a modal and restored on close |
| Escape closes a modal |
| status badges carry **text**, not colour alone |

Automated tools catch roughly a third of WCAG failures. The manual checks — keyboard-only completion of the calibration form and the verification page — are release gates, not test-suite items ([`../UI-UX/18-UX-ACCEPTANCE-CRITERIA.md`](../UI-UX/18-UX-ACCEPTANCE-CRITERIA.md) UX-35).

## Browser Suite

Playwright, `automate/`, 71 tests: auth, navigation, tenants, roles, users, kanban, notifications, account, profile, module health, theme.

### Flakes have been self-inflicted

Long runs have failed with `ECONNRESET` because editing a backend file triggered nodemon, which restarted the server mid-test.

**Do not chase a flake until you have confirmed nothing was recompiling.** Clean re-runs pass.

### Expected failures, kept deliberately

Two markers are retained rather than removed to make the suite look green:

| Marker | Status |
|---|---|
| user-edit modal, fuller-payload persistence | the backend was verified to persist correctly; the UI marker stands |
| a role display-name assertion | |

A suite made green by deleting the failing test is a suite that tells you nothing.

The tenant-create marker was the reverse case: it was a `test.fail()` whose own comment predicted it would flip when the backend was fixed — and it did.

## What Mocks Cannot Tell You

| Question | Answered by |
|---|---|
| Does the client send the right request? | mock test |
| Does the endpoint exist? | **live E2E** |
| Does it return the envelope we expect? | **live E2E** |
| Is the tenant predicate applied? | **live E2E, two tenants** |
| Does the screen render correctly? | component test |
| Does the whole flow work? | **browser suite** |

The three in bold are the ones that were missing when 3,863 tests passed over 13 broken endpoints.

## What the service tests prove, and what they do not

*(F-04, 2026-09-24.)* The `src/api/services/*.service.test.ts` files mock
`api/client.ts`. They prove the URL, the method, the payload the service
builds, and how it unwraps the body **we told the mock to return**. They cannot
fail when the endpoint is missing, when the backend changes the envelope, or
when a screen reads the wrong field. A green service suite is evidence about
the frontend's beliefs, not about the API — only the live E2E suite checks
those against the server.

What sits above them now, and runs the real code:

| Layer | Suites | Proves |
|---|---|---|
| API client interceptors | `api/client.session.f05.test.ts` (fake axios adapter — the real interceptors run) | 401 → one refresh → retry; unrenewable session → `/login` once; 403 modal on refused writes only; `X-Request-Id` and status on every rejection; FormData header; client timeout > server |
| Next route handlers | `app/api/v1/auth/{login,logout,logout-all,refresh,sso-session}/**/*.test.ts`, `[...path]/*.test.ts` | the cookies each handler writes and clears; the exact backend body shapes (fixtures copied from the controllers) |
| Route guard | `src/proxy.test.ts` | each redirect, cookie clearing on a dead token, the matcher |
| Stores | `stores/__tests__/*` incl. `dataStores.contract.test.ts` (`src/tests/support/storeContract.ts`) | every data store's success/failure contract; writes rethrow |
| Screen hooks | `app/dashboard/**/hooks/__tests__/*` | the screen logic (guards, payloads, failure paths) with services mocked |

## Coverage gate

`npm test` is `jest --coverage`, so the threshold in `frontend/jest.config.js`
is evaluated by `make test` / `make verify`. Until 2026-09-24 the script was
plain `jest`: the 70% threshold was never evaluated, and the real figure was
**28.13% statements** (986 tests).

Measured 2026-09-24, after F-03/F-04: **42.13% statements, 36.61% branches,
35.80% functions, 42.45% lines** (145 suites, 1,309 tests). The gate is set a
point under that — **41 / 35 / 34 / 41** — so it passes honestly and fails on a
regression.

**Ratchet to 70%.** Each step raises the four numbers in `jest.config.js` in
the same change that earns them; none is reached by excluding product code
(`collectCoverageFrom` excludes only `*.d.ts`, the two root layout/page files
and the test helpers under `src/tests/`).

| Step | Gate (stmts / branches / funcs / lines) | Where the coverage comes from |
|---|---|---|
| now | 41 / 35 / 34 / 41 | client, route handlers, proxy, stores, 12 screen hooks |
| 1 | 50 / 42 / 42 / 50 | the remaining screen hooks (`useStock`, `useMenuGroups`, `useWarehouse`, `useDevices`, `useTenants`, `useBoard`, …) and `lib/certificatePdf.ts` |
| 2 | 60 / 52 / 52 / 60 | the three-state tests for every list screen (loading / empty / **failed**) |
| 3 | 70 / 60 / 60 / 70 | page-level tests of the screens that carry a compliance figure; branches last |

Branch coverage trails because the pages' render branches are the least
tested; the target for branches stays behind the others until step 3.

## Running

```bash
npm test              # jest --coverage — the gate
npm run typecheck     # tsc --noEmit (turbo runs it for `make typecheck`)
npm run test:watch
npx playwright test   # browser suite
```

## Before a PR

- [ ] `pnpm lint` — including the React Compiler rules, not disabled
- [ ] `pnpm typecheck`
- [ ] `pnpm test` at the coverage gate
- [ ] `pnpm build`
- [ ] new services have contract tests asserting the **real** path and method
- [ ] new lists have all three state tests
- [ ] verified against a **running backend**, not only mocks
