# 08 — Color System

**In this product colour is status, and status is regulatory.** Every rule below follows from that.

---

## The Two Palettes, Kept Apart

| Palette | Owns | May be changed by a tenant |
|---|---|---|
| **Status** | compliance state | **never** |
| **Brand** | chrome, identity | yes — `tenants.primaryColor` |

`TenantBrandingProvider` applies the brand palette to navigation chrome, the logo area, and primary action accents. **It never touches the status palette** (P8).

Without that separation a tenant could choose a brand colour matching the overdue hue, and every decorative element on every screen would read as an alarm — or worse, the real alarms would stop standing out.

## Status Semantics

| Meaning | Hue family | Applies to |
|---|---|---|
| Compliant, current, active, completed | green | device `active`, calibration current, transfer `completed`, job `COMPLETED` |
| Attention, due soon, in progress | amber | due within 30 days, `in_transit`, `InProgress`, `PROCESSING`, `pending_approval` |
| **Alarm** — overdue, non-conformant, failed | red | **overdue**, `isCompliant: false`, `FAILED`, `CRITICAL`, `revoked` |
| Neutral, draft, unfinished | grey | `draft`, `inactive`, `PENDING`, `DRAFT` |
| Informational | blue | `SYSTEM` notifications, informational badges |

Red is reserved. If everything urgent is red, nothing is.

`maintenance` on a device is amber, not red — a device under maintenance is being looked after, which is the opposite of a problem being ignored.

## Never Colour Alone

**Every status badge carries text.** A red dot is not a status.

Around 8% of men have a colour vision deficiency, and the two most common types make red and green hard to distinguish — which is precisely the compliant/overdue distinction this product depends on.

This is not solely an accessibility concern. A printed or photocopied certificate loses colour entirely.

| Wrong | Right |
|---|---|
| a red dot | `Overdue` on a red badge |
| a green row | `Compliant` in the status column |
| colour-coded chart series | colour **plus** a direct label |

## Contrast

WCAG 2.1 AA, in **both** themes:

| Content | Ratio |
|---|---|
| Body text | 4.5:1 |
| Large text (18pt+, or 14pt bold) | 3:1 |
| UI components and graphical objects | 3:1 |
| Focus indicator | 3:1 against adjacent colours |

A status colour that passes in light and fails in dark is a failure. Both are first-class themes and both get checked.

## Dark Theme

Not an inverted light theme.

| Rule | Why |
|---|---|
| Surfaces are dark grey, not black | pure black with light text causes halation |
| Status hues are **desaturated and lightened** | a saturated red that works on white glows on dark |
| Elevation by surface lightness, not shadow | shadows are invisible on dark |
| Contrast re-verified, not assumed | inverting a passing pair does not preserve the ratio |

Dark matters here beyond preference: device and equipment areas of a hospital are often dim, and a screen that is the brightest object in the room is one people angle away from.

## Where Status Colour Appears

| Surface | Use |
|---|---|
| Dashboard tiles | the overdue tile is the one red thing on a healthy screen |
| Table status column | badge with text |
| Device register | status badge; **overdue is computed**, not a stored status |
| Certificate | one badge per state |
| Transfer | one badge per state |
| Verification page | the verdict, at `display` size |
| Notifications | typed by `SYSTEM`/`CALIBRATION`/`INVENTORY`/`MAINTENANCE` |

Overdue is derived from `nextCalibrationDate` at render, not read from a status column (BR-11). A device can be `active` **and** overdue simultaneously, and the UI shows both.

## The Verification Page

`/verify/[certificateNumber]` is the one screen where colour does the heaviest lifting, and the one screen where it must be least relied upon.

| Verdict | Colour | Text |
|---|---|---|
| Valid | green | **VALID** |
| Expired | amber | **EXPIRED** |
| Revoked | red | **REVOKED** |
| Not found | grey | **NOT FOUND** |

The word is the message. The colour reinforces it. An auditor reading this off a phone in poor light, possibly with a colour vision deficiency, gets the answer from the text.

## Charts

| Rule | |
|---|---|
| Direct labels, not a legend | a legend forces a colour-to-meaning lookup |
| Status colours keep their meaning | a red segment in a compliance chart means non-compliant, nowhere else |
| Pattern or shape as a second channel | for anything colour-coded |
| Never more than five series by colour | beyond that, small multiples |

## Print and PDF

Certificates are rendered by puppeteer using a separate stylesheet.

**Assume no colour at all.** The artefact will be printed, photocopied and scanned. Every distinction that matters on a certificate must survive greyscale, which means text and layout carry it.

## Tenant Branding in Practice

| Element | Branded |
|---|---|
| Sidebar chrome, header | yes |
| Logo | yes |
| Primary button accent | yes |
| Links | yes |
| **Status badges** | **no** |
| **Dashboard status tiles** | **no** |
| **Verification verdict** | **no** |
| **Charts encoding status** | **no** |

For a tenant-pinned build, branding is fetched from `GET /tenants/public` **before sign-in**, so the login page is already branded. That endpoint must expose branding only — it is read by anyone, unauthenticated.

## Adding a Colour

1. Is it status? Then it must be one of the five existing semantics. A sixth status meaning needs a design decision, not a new hex value.
2. Is it brand? Then it must not collide with any status hue.
3. Check contrast in **both** themes.
4. Check it is not the only carrier of the meaning.
5. Check it survives greyscale if it can reach a PDF.
