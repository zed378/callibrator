# 09 — Frontend Performance

---

## Targets

| Surface | Target | Why |
|---|---|---|
| Dashboard first meaningful paint | **under 2s** on hospital wifi | Rina has 60 seconds total (J1) |
| Tenant-scoped lists, p95 | under 500ms | Budi searches for a device many times a day |
| **Verification page interactive** | as fast as achievable | an unknown, possibly old phone, in unknown conditions |
| Public pages Lighthouse | **90+** | |
| Certificate PDF render | under 5s | server-side |

The verification page is the one measured on a stranger's device. It gets the strictest budget and the fewest dependencies.

## One Dashboard Endpoint

`GET /api/v1/dashboard/metrics` returns every tile.

A dashboard that fans out to twelve endpoints is twelve round trips on a hospital network, twelve chances to leak a tenant predicate, and twelve independent failure modes on the screen people trust most.

## Server Components by Default

`"use client"` only where interactivity, a browser API or a store is needed.

The two surfaces that benefit most:

| Surface | Benefit |
|---|---|
| `/verify/[certificateNumber]` | the verdict arrives without waiting for a JavaScript bundle |
| `/blog`, `/news` | content-first, indexable |

The dashboard is mostly client components by necessity, and that is fine — it is behind auth and not indexed.

## React 19 and the Compiler

The compiler handles most of what `useMemo` and `useCallback` were doing.

**Adding them by reflex now adds noise without adding speed.** Reach for manual memoisation only when a profile shows a specific problem, and leave a comment saying what it showed.

The compiler also flags `setState` in effects. Where a value is derivable during render, derive it — that is both the lint fix and the faster path.

## Store Subscriptions

```ts
const user = useAuthStore((s) => s.user);   // ✓ re-renders on user change
const { user } = useAuthStore();             // ✗ re-renders on ANY store change
```

The compiler cannot narrow a store subscription. This is the one memoisation-adjacent thing still worth doing by hand, and it is the most common cause of a dashboard that feels sluggish under live notifications.

## Lists

| Rule | |
|---|---|
| Paginate server-side | the API returns `meta` with `total`, `page`, `limit`, `totalPages` |
| Default page size 20 | |
| Do not fetch 5,000 devices to render 20 | |
| Virtualise only where a list is genuinely long and cannot paginate | the Kanban board |

Sort and filter go to the server and live in the **URL**, not in component state — a filtered view is a link someone sends.

## Bundle

| Rule | |
|---|---|
| Route-level code splitting is automatic in the App Router | |
| Heavy libraries are dynamically imported | TipTap, GSAP, jsPDF |
| The landing page's motion stack never reaches the dashboard bundle | |
| **The verification page imports almost nothing** | |

The last one is the discipline that matters. `/verify` should not pull in the editor, the charting library, or the motion stack because they happen to be in a shared chunk.

## Images

`next/image` with explicit dimensions or an aspect ratio, always. No layout shift.

The tenant logo on the login page is fetched from `GET /tenants/public` **before sign-in** — it must load fast and degrade to the tenant name if it fails. A broken logo on a branded login page reads as a broken deployment.

## Fonts

`font-display: swap` with a metric-compatible fallback.

**A webfont landing must not reflow a numeric column.** A serial-number column that shifts mid-read makes the reader lose their place during transcription, which is the same failure class as truncation ([`../UI-UX/07-TYPOGRAPHY.md`](../UI-UX/07-TYPOGRAPHY.md)).

Preload the mono face — it carries the serials and measurements.

## Caching

| Cached | Where | Invalidated by |
|---|---|---|
| Menu tree | `menuStore` | permission change, and a 403 |
| Tenant branding | `tenantBrandingStore` | tenant update |
| Domain lists | domain stores | **the corresponding write** |

Two rules that are easy to get wrong:

1. **Invalidate on write.** After creating a device the cache is stale; refetch or update it rather than waiting for a remount.
2. **Clear domain stores on tenant switch.** A super-admin moving between tenants with `x-tenant-id` must not see the previous tenant's cached rows. That is a cross-tenant leak in the browser, and no backend IDOR test finds it.

## Realtime

The bell count updates live. **The dashboard tiles do not.**

Beyond the trust argument ([`../UI-UX/16-MOTION-MICROINTERACTION.md`](../UI-UX/16-MOTION-MICROINTERACTION.md)), live-updating nine tiles on every socket message is a re-render storm on the busiest screen in the product.

Deduplicate notification arrivals by id — the store is fed by both the initial fetch and the socket.

## Skeletons

Match the final layout's dimensions.

| Duration | Treatment |
|---|---|
| Under 200ms | **nothing** — a flash of skeleton is worse than a brief wait |
| 200ms–2s | skeleton |
| Over 2s | skeleton plus progress |
| Over 30s | it should have been a batch job |

A list that collapses to a strip when empty and expands on load makes the page feel broken.

## Motion

No dashboard animation over 300ms. `prefers-reduced-motion` honoured. Motion never blocks first paint on the public pages.

## Build

| Command | Output |
|---|---|
| `npm run build` | `.next` |
| `npm run compile` | a standalone binary via `next-bun-compile` |

The Docker image builds with `oven/bun:1-alpine` and runs the compiled binary on `alpine:3.22` with only `libstdc++`, `libc6-compat` and `wget` — **no Node runtime in the final image**.

## Measuring

| Layer | Tool |
|---|---|
| Public pages | Lighthouse in CI |
| Bundle size | `@next/bundle-analyzer` |
| Runtime | React DevTools Profiler |
| Real conditions | **throttled to slow 3G on a 375px viewport** |

The last one is the honest test. Hospital wifi is not a fast connection, and the two personas who use this product most are on phones.
