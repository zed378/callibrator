# 00 — Frontend Standards

Next.js 16.3 · React 19.3 · TypeScript 7 (checker) beside the TypeScript 6 API · Tailwind CSS 4 · Zustand 5 · Node 26 (`frontend/package.json`, root `.nvmrc`; ADR-076). **Corrected 2026-09-29:** this line said TypeScript 5.

Architecture: [`../ARCHITECTURE/02-FRONTEND-ARCHITECTURE.md`](../ARCHITECTURE/02-FRONTEND-ARCHITECTURE.md).

---

## TypeScript

The frontend has always been TypeScript. (The backend is now mixed JavaScript and TypeScript, migrating under ADR-038; this line used to cite the superseded ADR-030.)

| Rule | |
|---|---|
| No `any` | use `unknown` and narrow |
| Explicit return types on exported functions | |
| API response types in `src/types/` | |
| **`npm run typecheck` must pass** | TypeScript 7 (`@typescript/native`), called by path: `node ../node_modules/@typescript/native/bin/tsc --noEmit`. **Not** `npx tsc`, which is not TypeScript 7 (ADR-076) |

**Two type checks gate a change, and they can disagree** (ADR-076): `npm run typecheck` checks with TypeScript 7; `next build` runs its own type-check step on the TypeScript 6 API package (`typescript` is `npm:@typescript/typescript6`), and `ignoreBuildErrors` is not set. A change must pass both. Tests do not type-check: ts-jest runs transpile-only (`isolatedModules: true`). `frontend/tsconfig.json` is `strict` but lacks `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; tightening it to the backend standard is not scheduled.

Types for API responses are hand-written, not generated. There is no shared `packages/` workspace yet — `packages/*` in the root workspace glob matches nothing (no `packages/` directory, 2026-09-29). *Target (P9-22, ADR-038):* `packages/contracts` holding the backend's Zod request schemas, consumed here.

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

### The Next proxy owns `/api/`

As built (ADR-046, ADR-059, ADR-074): nginx sends **every `/api/` request to Next**, not to the backend. `src/app/api/v1/[...path]/route.ts` relays it to `API_BASE_URL`, and the handlers beside it (`auth/login`, `logout`, `refresh`, `sso-session`, …) own the session:

- **The browser never holds the access token.** The token lives in an httpOnly cookie Next sets; the proxy attaches it upstream and strips `token` / `refreshToken` from a JSON answer before the browser sees it (A-71). Never add a code path that reads a token in client JavaScript.
- **Only the OIDC binding cookie crosses** in either direction; every other backend `Set-Cookie` is dropped (A-68). Redirects pass through (`redirect: "manual"`, A-69).
- **Bodies stream** both ways; only a small 2xx JSON answer that could carry a token is read (F-16). The proxy aborts its upstream wait at 32 s and answers **504** in the envelope; the client's budget is 35 s and the backend's 30 s (`src/constants/index.ts`, F-14). `ErrorState` treats 504 like 408, as a retryable timeout.
- A caller's `Authorization` (an API key) is forwarded only when there is no session cookie; the cookie always wins.
- Backend-issued links are **same-origin `/api/v1/` paths** rendered through `toSameOriginApiPath` (`lib/uploadUrl.ts`), never prefixed with `NEXT_PUBLIC_API_BASE_URL` (F-11).

A service therefore calls relative `/api/v1/…` paths through `client.ts`; it never talks to the backend's own origin.

## Content Security Policy

As built (ADR-071): the content origin sends a **per-request nonce CSP with `'strict-dynamic'`**, minted in `src/proxy.ts` (the Next 16 "proxy", formerly middleware) and built by `src/lib/securityHeaders.ts`. What that means for code:

- **Every page renders per request.** The root layout reads `headers()` and exports `instant = false`; a prerendered page or static shell would have no nonce and none of its scripts would run. `use cache` data caching is unaffected.
- **No inline `<script>` of your own** except through the nonce (`x-nonce`, read in a Server Component — `ThemeInitScript` is the one). No `on*=` attributes (`script-src-attr 'none'`), no `eval`.
- **A `<style>` element needs the nonce; a `style={{…}}` attribute does not** (`style-src-attr 'unsafe-inline'`). Prefer Tailwind classes; do not inject `<style>`.
- **Images come from `'self'`, `data:`, `blob:` and the API origin only.** An absolute URL to another host does not load — upload the file instead.
- A page path excluded from the proxy `matcher` gets **no CSP**. The matcher excludes only `api`, `_next/static`, `_next/image`, `favicon.ico` and `uploads/public/`; do not widen it.
- Dev differs from production (`'unsafe-eval'` and inline `<style>` allowed under `next dev`), so verify a CSP-sensitive change on a production build. Tests: `src/lib/securityHeaders.test.ts`, `src/proxy.test.ts`; the browser smoke (`make test-browser`) checks for CSP violations.

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

`axe` (axe-core) runs in the **component** suite (`src/tests/a11y/axe.ts`; `a11y.f12`, `a11y.f12b`, `a11y.f12.overlays`, `a11y.adr090`), with colour contrast and page-level rules off because jsdom has no layout; `a11y.adr090` checks the theme tokens' contrast from `globals.css` instead. The rules ([ADR-090](../../MEMORY/DECISIONS.md), ADR-074):

- **Colour comes from the theme tokens**, which are chosen to pass 4.5:1 as text on `--background`/`--card`, on their own `/10` and `/15` tints, and as `-foreground` on the solid fill, in both themes. A token edited below the line fails `a11y.adr090`. Never hard-code `text-white` on a token fill — use its `-foreground` (dark-theme primary and destructive are light fills with dark text).
- **No opacity on text** to de-emphasise it (`text-muted-foreground/60`, `opacity-60`); use size and weight.
- **Every page has one `<main>` and one `<h1>`**, and heading levels do not skip. `CardHeader`'s string title is an `<h2>`; `Alert`'s title is a paragraph.
- **An icon-only control is named after its object** — `aria-label={\`Edit ${device.name}\`}`, not "Edit" — and its icon is `aria-hidden`. A visible `<label>` is associated with `htmlFor`/`id`, never replaced by an `aria-label`.
- **Every overlay is a modal dialog** (`role="dialog"`, `aria-modal`, `aria-labelledby`, `useModalA11y`: focus in, Tab trapped, Escape closes, focus restored).
- *Open (ADR-090):* a tenant-set brand `--primary` is not contrast-checked. **The browser suite does not run axe yet** — one full sweep of every route in Chrome was run by hand on 2026-09-29 (F-12), and no screen-reader walk has been recorded (F-12, ADR-074). See [`../UI-UX/17-ACCESSIBILITY.md`](../UI-UX/17-ACCESSIBILITY.md).

## Before Opening a PR

```bash
cd frontend
npm run lint          # eslint — errors fail; CI runs `npx eslint`
npm run typecheck     # TypeScript 7 (ADR-076) — verified exit 0 on 2026-09-29
npm test              # jest --coverage; the gate is the measured figure (ADR-067)
npm run build         # next build — also type-checks with the TypeScript 6 API
```

npm, not pnpm: the package manager is npm and the committed lockfile is the root `package-lock.json` (ADR-044). **Corrected 2026-09-29:** this block said `pnpm`.

## Environment Trap

On Windows, `npm run dev` failing with `EACCES` on port 3000 is **not** a port-in-use problem. It is the WinNAT reserved port range.

Either restart `winnat` from an elevated prompt, or run `next dev -p 4000`. Hunting for the process holding port 3000 will not find one.
