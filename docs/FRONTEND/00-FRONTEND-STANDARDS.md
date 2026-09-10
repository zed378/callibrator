# 00 — Frontend Standards

Next.js 16 · React 19.2 · TypeScript 5 · Tailwind CSS 4 · Zustand 5.

Architecture: [`../ARCHITECTURE/02-FRONTEND-ARCHITECTURE.md`](../ARCHITECTURE/02-FRONTEND-ARCHITECTURE.md).

---

## TypeScript

Unlike the backend (ADR-030), the frontend **is** TypeScript, and the standard applies here.

| Rule | |
|---|---|
| No `any` | use `unknown` and narrow |
| Explicit return types on exported functions | |
| API response types in `src/types/` | |
| `pnpm typecheck` must pass | |

Types for API responses are hand-written, not generated. There is no shared `packages/` workspace — a CommonJS JavaScript backend and a TypeScript frontend share no code (`packages/*` in the workspace glob matches nothing).

That means **the types are a belief about the API, not a guarantee**. They can drift, and they have. Contract tests are what keep them honest.

## React 19 and the Compiler

The React Compiler changes what the linter accepts. Two patterns that used to pass now do not, and every component author hits them early.

**1. `setState` in an effect without a guard.** The compiler flags the setState-in-effect pattern that used to be routine. Derive during render where the value is derivable; use an effect only for genuine synchronisation with something outside React.

**2. Manual memoisation is usually unnecessary.** The compiler handles most of what `useMemo` and `useCallback` were doing. Adding them by reflex now adds noise without adding speed.

`eslint-config-next` enforces both. Do not disable the rules to make a build pass — the rule is usually right about the component.

## File Layout

```
src/app/dashboard/<domain>/
├── page.tsx
├── components/     local to this domain
└── hooks/          local to this domain
```

**Local by default.** A component moves to `src/components/` when a **second** domain needs it, not in anticipation.

Premature promotion is how `src/components/` becomes a landfill nobody dares delete from, and it is how a domain stops being deletable.

## API Access

Never call `axios` from a component. The layering is:

```
page → hook → service (src/api/services/) → client.ts → API
```

| Layer | Owns |
|---|---|
| `client.ts` | base URL, auth header, **envelope unwrap**, error normalisation |
| service | one module per backend domain, one function per endpoint |
| hook | loading, error and empty state for one screen |
| page | layout and composition |

### The envelope

```
{ success, status, message, data, meta? }
```

**Rows are in `data`. Pagination is in a top-level `meta`, a sibling of `data`.** There is no `data.rows`, no `data.items`, no `data.meta`.

`client.ts` unwraps `data` and surfaces `meta` separately. A service that reaches past the unwrap is doing it wrong.

Getting this wrong renders an empty list with **no error** — which is exactly what happened to the QMS and SOP screens for weeks.

## Every Service Has a Contract Test

51 services, 51 `*.service.test.ts` files. Each asserts:

- the exact path, including any oddity such as the doubled `/menu-groups/menu-groups/admin`
- the HTTP method — several endpoints use `PATCH` where `PUT` would be expected
- the payload shape
- the envelope unwrap, including the `[]` and `null` fallbacks

These exist because they were once absent and it mattered: services had been written against endpoints that **did not exist**, with tests mocking the fabrication. Thousands of tests passed while the endpoints were broken.

**A mock test proves the client calls what the developer believed. Only a live call proves the contract.** Both are needed. See [`10-TESTING.md`](./10-TESTING.md).

## State

Zustand, one store per concern.

**A store is for state that outlives a page.** Data fetched for one screen belongs in that screen's hook.

A domain store that exists only because one page needed it is a memory leak with a nice API — it holds stale data for the rest of the session and nothing invalidates it.

| Legitimate stores | |
|---|---|
| `authStore` | session, user, role |
| `menuStore` | the server-resolved menu tree |
| `tenantBrandingStore` | populated pre-auth for pinned builds |
| `notificationStore` | live arrivals from the socket |
| `toastStore` | transient feedback |

## Authorization Is Not a Frontend Concern

The sidebar is built from the menu tree the **server** resolved. There is no client-side permission array.

An unauthorised surface is **absent**, not hidden — a hidden element is still in the DOM and its route is still reachable by typing the URL.

The backend enforces on every route regardless. See [`05-RBAC-IN-UI.md`](./05-RBAC-IN-UI.md).

## Errors Are a UI State, Not a Console Message

Every list has three states: loading, empty, **failed**. `EmptyState` and `ErrorState` are separate components.

Rendering an empty list when the request failed is a lie about a compliance figure. This is the single most important frontend rule in the product.

## Naming

| Thing | Convention |
|---|---|
| Component files | `PascalCase.tsx` |
| Hooks | `useThing.ts` |
| Services | `<domain>.service.ts` |
| Stores | `<domain>Store.ts` |
| Types | `PascalCase` in `src/types/` |
| Tests | `<name>.test.ts(x)` beside the subject |

## Styling

Tailwind, with semantic tokens from `globals.css`. Components reference **semantic** tokens, never primitives — that is what makes theming and tenant branding work without touching a component.

No CSS-in-JS. No component-scoped stylesheets except where a third-party library requires one.

## Accessibility Is Not Optional

Semantic HTML first, ARIA second. Every control labelled, every focus visible, `prefers-reduced-motion` honoured.

`axe` runs in the component and browser suites. See [`../UI-UX/17-ACCESSIBILITY.md`](../UI-UX/17-ACCESSIBILITY.md).

## Before Opening a PR

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Environment Trap

On Windows, `npm run dev` failing with `EACCES` on port 3000 is **not** a port-in-use problem. It is the WinNAT reserved port range.

Either restart `winnat` from an elevated prompt, or run `next dev -p 4000`. Hunting for the process holding port 3000 will not find one.
