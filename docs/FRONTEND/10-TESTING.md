# 10 — Frontend Testing

Jest 30 · Testing Library · jsdom. Coverage gate: **70%**.

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

`axe` in the component suite. Plus assertions that automated tools cannot make:

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

## Running

```bash
npm test              # jest
npm run test:watch
npm run test:coverage # 70% gate
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
