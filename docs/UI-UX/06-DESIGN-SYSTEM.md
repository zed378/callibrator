# 06 — Design System

Tailwind CSS 4 with `@tailwindcss/postcss`. Tokens live in `globals.css` as CSS custom properties; Tailwind consumes them.

---

## Token Layers

```
primitives   raw values — a colour ramp, a type scale, a spacing step
    ↓
semantic     what a value MEANS — surface, border, status-overdue
    ↓
component    what a component uses — button-primary-bg
```

Components reference **semantic** tokens, never primitives. That is what makes theming and tenant branding possible without touching a component.

## Theme

Light and dark are both first-class. `ThemeInitScript` runs before paint so there is no flash of the wrong theme; `ThemeToggle` persists the choice.

Dark is not decorative here — device and equipment areas of a hospital are often dim, and a screen that is the brightest object in the room is one people angle away from.

Semantic tokens are redefined per theme. **Contrast requirements hold in both** ([`17-ACCESSIBILITY.md`](./17-ACCESSIBILITY.md)); a status colour that passes in light and fails in dark is a failure.

## Tenant Branding

`tenants.primaryColor` and `tenants.logo`, applied by `TenantBrandingProvider`.

**Branding touches chrome and identity only. It never touches the status palette.**

That constraint exists so a tenant cannot choose a brand colour that makes decorative elements read as a warning — or worse, that matches the overdue colour and dilutes it (P8).

For a tenant-pinned build (`NEXT_PUBLIC_TENANT_ID`), branding is fetched from `GET /tenants/public` **before sign-in**, so the login page is already branded.

## Core Components

| Component | Notes |
|---|---|
| Button | primary, secondary, ghost, destructive |
| Input, Select, Textarea, DatePicker | consistent error and helper slots |
| Table | one implementation — see below |
| Pagination | driven by the top-level `meta` |
| Modal, Drawer | focus-trapped, Escape closes, focus restored |
| Toast | `toastStore`; never the only signal for anything important |
| Badge | status — see [`08-COLOR-SYSTEM.md`](./08-COLOR-SYSTEM.md) |
| Card, Tabs, Tooltip | |
| Skeleton | loading |
| EmptyState, ErrorState | **two distinct components** |
| AccessDeniedModal | route reached without permission |
| ThemeToggle, TenantBrandingProvider | |
| Editor | TipTap, for `posts.contentHtml` |

## One Table, One Envelope

Every list in the product renders rows from `data` and pagination from a **top-level `meta`** ([`../API/00-API-STANDARDS.md`](../API/00-API-STANDARDS.md)).

One table component enforces that. A screen that invents its own list shape will render empty the day the envelope changes, and nobody will notice — which is exactly what happened to the QMS and SOP screens.

### Three list states, always distinguished

| State | Component |
|---|---|
| Loading | `Skeleton` |
| Empty | `EmptyState` — "no devices yet", with the action to create one |
| Failed | `ErrorState` — "could not load devices", with retry |

`EmptyState` and `ErrorState` are separate components on purpose. Rendering an empty list when the request failed is a lie about a compliance figure (P3).

## Form Conventions

| Rule | |
|---|---|
| Label above the field, always | never placeholder-as-label |
| Required marked on the field, not inferred from an asterisk legend | |
| Errors inline, beside the field | plus a summary for screen readers |
| Server 400 field errors map back to fields | the API returns field detail; use it |
| Destructive submit is visually distinct | and confirmed |
| Autosave nowhere in the compliance path | a calibration record is saved deliberately |

## Status Presentation

Every domain state that appears in the product is a `Badge` with a semantic token:

| Domain | States |
|---|---|
| Device | active · inactive · maintenance · retired |
| Certificate | draft · pending_approval · approved · signed · revoked |
| Transfer | pending · in_transit · completed · cancelled |
| Work order | Open · InProgress · Completed · Cancelled |
| Non-conformance | OPEN · UNDER_INVESTIGATION · CAPA_REQUIRED · CLOSED |
| Batch job | PENDING · PROCESSING · COMPLETED · FAILED |
| Calibration | overdue · due soon · current — **computed, not stored** |

The last row matters: overdue is derived from `nextCalibrationDate`, not from a status column (BR-11). The badge is computed at render.

**Never colour alone.** Every status badge carries text (`17-ACCESSIBILITY.md`).

## Attribution Display

Records carrying attribution show it — who, and when. Certificates show `calibratedBy`, `approvedBy` and `signedBy` as **three separate people**, because that separation is the evidence (P5).

Collapsing them into "last modified by" destroys at the interface exactly what the schema went to trouble to preserve.

## Spacing and Type

See [`07-TYPOGRAPHY.md`](./07-TYPOGRAPHY.md) and [`09-SPACING-GRID.md`](./09-SPACING-GRID.md).

Density follows task (P7): dense where scanning for an exception, spacious where entering data that must be right.

## Motion

Minimal in the dashboard, and always redundant with a non-motion signal. `prefers-reduced-motion` honoured throughout. See [`16-MOTION-MICROINTERACTION.md`](./16-MOTION-MICROINTERACTION.md).

The public surfaces are a different register — [`19-IMMERSIVE-REVAMP-PLAN.md`](./19-IMMERSIVE-REVAMP-PLAN.md).

## Where Components Live

```
src/components/                 shared across domains
src/app/dashboard/<domain>/components/   local to one domain
```

Local by default. A component is promoted to `src/components/` when a **second** domain needs it, not in anticipation. Premature promotion is how `src/components/` becomes a landfill nobody dares delete from.

## React 19 and the Compiler

The React Compiler changes what the linter accepts. Two patterns that used to pass now do not — see [`../FRONTEND/00-FRONTEND-STANDARDS.md`](../FRONTEND/00-FRONTEND-STANDARDS.md). Component authors will hit this before they hit anything else.
