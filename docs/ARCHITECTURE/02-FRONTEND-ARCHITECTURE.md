# 02 — Frontend Architecture

Standards and conventions are in [`../FRONTEND/00-FRONTEND-STANDARDS.md`](../FRONTEND/00-FRONTEND-STANDARDS.md). This document is the structural picture.

---

## Stack

| Concern | Choice | Version |
|---|---|---|
| Framework | Next.js, App Router | 16 |
| UI | React | 19.2 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | 4 (with `@tailwindcss/postcss`) |
| State | Zustand | 5 |
| HTTP | axios | 1 |
| Realtime | socket.io-client | 4.8 |
| Motion | framer-motion / motion, GSAP, Lenis | — |
| Rich text | TipTap | 3 |
| Icons | lucide-react | — |
| PDF / QR | jspdf, qrcode | — |
| Test | Jest, Testing Library, jsdom | 30 |

React 19 with the React Compiler changes what the linter accepts. Two patterns that used to be fine now warn or error — see [`../FRONTEND/00-FRONTEND-STANDARDS.md`](../FRONTEND/00-FRONTEND-STANDARDS.md).

## Route Structure

```
src/app/
├── (public)
│   ├── page.tsx                    landing
│   ├── login, register             auth surfaces
│   ├── blog/, blog/[slug]          CMS-backed
│   ├── news/, news/[slug]
│   └── verify/[certificateNumber]  public certificate verification (no auth)
│
├── api/v1/[...path]                proxy to the Express API
├── api/v1/auth                     auth-specific proxy handling
│
└── dashboard/                      authenticated surface, ~60 domains
    ├── layout.tsx                  sidebar from the server-resolved menu tree
    ├── page.tsx                    dashboard tiles
    ├── components/                 dashboard-wide shared components
    ├── hooks/
    └── <domain>/                   one directory per backend domain
        ├── page.tsx
        ├── components/             local to this domain
        └── hooks/                  local to this domain
```

Domains under `/dashboard`, matching backend modules: `devices`, `calibration`, `calibration-scheduler`, `stock`, `maintenance`, `predictive-maintenance`, `qms`, `sop`, `risk`, `supplier-scorecard`, `esignature`, `attachments`, `storage`, `audit`, `reports`, `notifications`, `users`, `roles`, `permissions`, `user-permissions`, `menu-groups`, `tenants`, `tenant-hierarchy`, `tenant-lifecycle`, `data-retention`, `gdpr`, `billing`, `finance`, `metered-billing`, `api-keys`, `custom-domains`, `feature-flags`, `network-security`, `oidc`, `scim`, `webauthn`/`mfa`, `session-management`, `batch-jobs`, `ai-assistant`, `kanban`, `tickets`, `content`, `profile`, `change-password`.

**Local-first component placement.** A component used by one domain lives in that domain directory. Only genuinely shared UI is promoted to `src/components/`. This keeps a domain deletable and stops `src/components/` becoming a landfill.

## API Layer

```
src/api/
├── client.ts              axios instance: base URL, auth header, envelope unwrap, errors
└── services/              one module per backend domain — 51 services, 51 tests
    ├── auth.service.ts
    ├── device.service.ts
    ├── calibration.service.ts
    └── ...
```

Every service has a sibling `*.service.test.ts` asserting the exact path, HTTP method, payload shape, and envelope unwrap including the `[]` and `null` fallbacks.

Those tests exist because they were once absent and it mattered: several services were written against endpoints that did not exist, with tests mocking the fabrication. Thousands of tests passed while the endpoints were broken (PR-7).

### The envelope

```
{ success, status, message, data, meta? }
```

**Rows are in `data`. Pagination is in a top-level `meta`, a sibling of `data`.** There is no `data.rows` and no `data.meta`. Getting this wrong renders an empty list with no error — which is exactly what happened to the QMS and SOP screens until the backend was corrected.

`client.ts` unwraps `data` and surfaces `meta` separately. A service that reaches past the unwrap is doing it wrong.

## State Management

Zustand, one store per concern:

| Store | Holds |
|---|---|
| `authStore` | session, user, token, role |
| `menuStore` | the server-resolved menu tree |
| `tenantBrandingStore` | logo, colour, name — populated pre-auth for pinned builds |
| `notificationStore` | live notifications from the socket |
| `toastStore` | transient UI feedback |
| `deviceStore`, `calibrationStore`, `stockStore`, `warehouseStore`, `userStore`, `roleStore`, `tenantStore`, `tenantBackupStore`, `kanbanStore` | domain caches |

Rule: a store is for state that **outlives a page**. Data fetched for one screen belongs in that screen's hook, not in a global store. A domain store that exists only because one page needed it is a memory leak with a nice API.

## Authorization in the UI

The sidebar is rendered from the menu tree returned by `GET /api/v1/menu-groups`, resolved server-side against the caller's role and per-user overrides.

**An unauthorised surface is absent, not hidden.** There is no client-side permission array driving `display: none`, because a hidden element is still in the DOM and its route is still reachable by typing the URL.

`AccessDeniedModal` handles the case where a route is reached anyway — a stale menu, a permission revoked mid-session, a bookmarked URL.

The client is not the enforcement point. Every backend route enforces independently ([`../SECURITY/04-AUTHORIZATION-RBAC.md`](../SECURITY/04-AUTHORIZATION-RBAC.md)).

## Realtime

`src/lib/socket.ts` wraps socket.io-client:

1. request a short-lived socket token from the API (`socketToken.service.ts`),
2. connect with it,
3. join the tenant room using a **raw id**, not a prefixed name,
4. push arrivals into `notificationStore`,
5. optionally play a sound (`lib/notificationSound.ts`, respecting browser autoplay policy).

The short-lived token exists so the long-lived access token is never handed to a transport that keeps it for the connection lifetime.

## Theming

Light and dark, with `ThemeInitScript` running before paint to avoid a flash of the wrong theme. `ThemeToggle` persists the choice.

Tenant branding (`TenantBrandingProvider`) applies `primaryColor` and `logo`. For a pinned build (`NEXT_PUBLIC_TENANT_ID`) branding is fetched **before** sign-in, so the login page is already branded.

## Public Surfaces

| Route | Purpose |
|---|---|
| `/` | landing — the immersive design in [`../UI-UX/19-IMMERSIVE-REVAMP-PLAN.md`](../UI-UX/19-IMMERSIVE-REVAMP-PLAN.md) |
| `/blog`, `/blog/[slug]` | CMS-backed content |
| `/news`, `/news/[slug]` | CMS-backed content |
| `/verify/[certificateNumber]` | **unauthenticated** certificate verification |

`/verify` is the one public route that is functionally load-bearing rather than marketing. It must work without a session, without JavaScript-heavy dependencies, and on whatever browser an auditor happens to have.

## Build and Distribution

| Command | Output |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` | `.next` |
| `npm run compile` | standalone binary via `next-bun-compile` |
| `npm run build:binary` | build then compile |

The Docker image builds with `oven/bun:1-alpine` and runs the compiled binary on `alpine:3.22` with only `libstdc++`, `libc6-compat` and `wget` — no Node runtime in the final image.

## Known Environment Trap

On Windows, `npm run dev` failing with `EACCES` on port 3000 is **not** a port-in-use problem. It is the WinNAT reserved port range. Either restart `winnat` from an elevated prompt, or run `next dev -p 4000`.
