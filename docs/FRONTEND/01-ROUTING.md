# 01 — Routing

Next.js 16 App Router. `frontend/src/app/`.

---

## The Tree

```
src/app/
├── page.tsx                        landing
├── login/  register/               auth
├── blog/  blog/[slug]/             CMS-backed
├── news/  news/[slug]/
├── verify/[certificateNumber]/     PUBLIC certificate verification
│
├── api/v1/[...path]/               catch-all proxy to the Express API
├── api/v1/auth/                    auth-specific proxy handling
│
└── dashboard/
    ├── layout.tsx                  sidebar from the server-resolved menu tree
    ├── page.tsx                    tiles
    ├── components/  hooks/
    └── <domain>/                   ~60 domains
        ├── page.tsx
        ├── components/
        └── hooks/
```

## Route Groups by Trust

| Group | Auth | Notes |
|---|---|---|
| Landing, blog, news | none | marketing and content |
| `/login`, `/register` | none | branded pre-auth for pinned builds |
| **`/verify/[certificateNumber]`** | **none** | functionally load-bearing |
| `/dashboard/*` | required | everything else |

`/verify` is the only public route that is a working tool rather than marketing. It must work without a session, without heavy client dependencies, and on an untested phone ([`../UI-UX/14-PUBLIC-SURFACES-UX.md`](../UI-UX/14-PUBLIC-SURFACES-UX.md)).

## Dashboard Domains

One directory per backend domain, matching the menu slugs:

```
devices  calibration  calibration-scheduler  maintenance  predictive-maintenance
stock  qms  sop  risk  supplier-scorecard  esignature  attachments  storage
audit  reports  notifications  users  roles  permissions  user-permissions
menu-groups  tenants  tenants/[tenantId]  tenant-hierarchy  tenant-lifecycle
data-retention  gdpr  billing  finance  metered-billing  api-keys
custom-domains  feature-flags  network-security  oidc  scim  mfa
session-management  batch-jobs  ai-assistant  kanban  kanban/[projectId]
tickets  tickets/raise  tickets/response  tickets/[ticketId]
content  content/new  content/[id]  profile  change-password
```

## Colocation

```
<domain>/
├── page.tsx
├── components/     ← local
└── hooks/          ← local
```

Local by default. Promotion to `src/components/` happens when a **second** domain needs it, not in anticipation.

This keeps a domain deletable: removing `predictive-maintenance` means removing one directory, not hunting through a shared components folder.

## The API Proxy

`src/app/api/v1/[...path]/` is a catch-all that forwards to the Express API, supported by `src/proxy.ts`.

Two paths exist for reaching the API:

| Path | When |
|---|---|
| Browser → API origin directly, with a Bearer token | the default |
| Browser → same-origin `/api/v1/...` → proxy → API | where a strict CSP or a corporate proxy makes cross-origin awkward |

Which one a given service uses is decided in `src/api/client.ts` via `NEXT_PUBLIC_API_BASE_URL`.

**The proxy must not become an authorization bypass.** It forwards the caller's credentials; it adds none of its own. A proxy that attaches a service credential turns every route behind it into an unauthenticated one.

## Authentication Gate

`dashboard/layout.tsx` is the gate:

1. `AuthInitializer` restores the session
2. no session → redirect to `/login`
3. session → `GET /api/v1/menu-groups` → `menuStore`
4. sidebar rendered from the resolved tree

**The menu tree is navigation, not enforcement.** Every backend route enforces independently. A route reached anyway — stale menu, permission revoked mid-session, a bookmark — shows `AccessDeniedModal`.

## Dynamic Segments

| Route | Segment |
|---|---|
| `/verify/[certificateNumber]` | the public identifier, not a UUID |
| `/dashboard/tenants/[tenantId]` | UUID |
| `/dashboard/kanban/[projectId]` | UUID |
| `/dashboard/tickets/[ticketId]` | UUID |
| `/dashboard/content/[id]` | UUID |
| `/blog/[slug]`, `/news/[slug]` | slug |

`certificateNumber` is deliberately not a UUID — it is the human-readable number printed on the certificate and encoded in the QR.

## URL State

Sort, filter and pagination live **in the URL**, not in component state.

A filtered device register is a message someone sends — "here is the overdue list" is a link. Component state cannot be shared, cannot be bookmarked, and is lost on refresh.

## Metadata and SEO

| Route | Metadata |
|---|---|
| Landing, blog, news | full, with Open Graph and structured data |
| `/verify/[certificateNumber]` | **`noindex`** |
| `/dashboard/*` | minimal, `noindex` |

`/verify` must not be indexed: certificate numbers in a search index are an enumeration surface, and the page has no value to a search engine.

## Loading and Error Boundaries

`loading.tsx` and `error.tsx` per route segment. Skeletons match the final layout's dimensions so nothing jumps when data arrives.

See [`08-ERROR-BOUNDARIES.md`](./08-ERROR-BOUNDARIES.md).

## Server and Client Components

Server components by default. `"use client"` only where interactivity, browser APIs or a store is needed — which in practice is most of the dashboard.

The public content routes (`/blog`, `/news`) and `/verify` benefit most from server rendering: `/verify` in particular should deliver its verdict without waiting for a JavaScript bundle, because the reader is on an unknown device in unknown conditions.

## Middleware

Route protection at the layout level rather than in `middleware.ts`, so redirect logic sits beside the layout that owns it.

Auth is verified server-side on every API call regardless. Frontend routing controls what is convenient, never what is permitted.
