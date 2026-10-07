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
| Not yet valid | amber | **NOT YET VALID** |
| Revoked | red | **REVOKED** |
| Withdrawn | red | **WITHDRAWN** |
| Not found | grey | **NOT FOUND** |

Six, not four: these are the verdicts the page computes (`frontend/src/app/verify/[certificateNumber]/page.tsx`); this table listed four until ADR-098.

The word is the message. The colour reinforces it. An auditor reading this off a phone in poor light, possibly with a colour vision deficiency, gets the answer from the text.

## Charts

| Rule | |
|---|---|
| Direct labels, not a legend | a legend forces a colour-to-meaning lookup |
| Status colours keep their meaning | a red segment in a compliance chart means non-compliant, nowhere else |
| Pattern or shape as a second channel | for anything colour-coded |
| Never more than five series by colour | beyond that, small multiples |
| Categorical series use `--chart-1` … `--chart-5` (ADR-122) | copper, blue, green-teal, plum, ochre, in that order; each ≥ 3:1 on card and page in both themes. Series 4 and 5 carry a marker or pattern as well |
| Status series use `--status-*` | never a `--chart-n` |
| Priority is not a status | kanban urgent/high/medium/low is a sequential copper ramp with labels, never the alarm red |

## Print and PDF

Certificates are rendered by puppeteer using a separate stylesheet.

**Assume no colour at all.** The artefact will be printed, photocopied and scanned. Every distinction that matters on a certificate must survive greyscale, which means text and layout carry it.

## The Product's Own Brand

**Amended by ADR-118 Amendment 2 and ADR-122.** The navy `#001250` and teal `#00DAB4` this section used to give were replaced on 2026-10-05; the shape is unchanged.

| | Light | Dark | Used for |
|---|---|---|---|
| Charcoal / ivory | **`#1F1B17`** | **`#F6EFE4`** | the mark's body and the wordmark (`--logo-ink`) |
| Copper / light copper | **`#9A4E22`** | **`#E3A47B`** | the accent: three ruler ticks and the lower-right block (`--logo-accent`) |
| Warm charcoal tile | `#241E19` | | the app icon panel and the dark lockup |

Assets live in [`../../frontend/public/brand/`](../../frontend/public/brand/): `mark.svg`, `mark-dark.svg`, `app-icon.svg`, and three lockups (`lockup-light`, `lockup-dark`, `lockup-mono`). They were cut from the supplied `icon.svg` brand sheet, which held all four variants on one CorelDRAW artboard.

In the application the mark is **not** loaded as a file. `components/brand/BrandIcon.tsx` inlines it, for two reasons:

1. `next/image` answers **400 for SVG** unless `dangerouslyAllowSVG` is set — see [`../FRONTEND/07-MEDIA-HANDLING.md`](../FRONTEND/07-MEDIA-HANDLING.md);
2. the mark must work on both themes, so its body is **`currentColor`** and the caller sets `text-logo-ink`; the accent elements carry `.logo-accent`, filled with `var(--pub-accent, var(--logo-accent))`. Both tokens flip with the theme, so no `dark:` colour variant is needed.

**This is the product's identity, not a tenant's.** It is what shows when a tenant has supplied no logo, and it is deliberately separate from `tenants.primaryColor` below — a tenant brand colour never recolours the mark.

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

**On the public surfaces (ADR-098, ADR-118) the tenant brand is its logo and name only, never its colour:** the public pages have one fixed accent (copper), and an arbitrary tenant colour cannot be contrast-checked against both their light and dark palettes in advance.

**In the dashboard a tenant brand overrides `--primary` only** (and, since ADR-122, `--primary-hover` / `--primary-pressed`, derived from it). `lib/brandColor.ts` derives one accessible shade per theme against the warm surfaces; it never reaches `--status-*`, a badge or a chart series.

## The Dashboard Palette (ADR-122)

The dashboard follows the public palette's family, tempered for density: warm neutral surfaces, charcoal ink and copper actions in light; espresso, ivory and a light copper in dark. No grain, no serif, no cream panels under tables. The tokens are defined in `frontend/src/app/globals.css`; every pair below is recomputed from that file by `components/ui/a11y.adr090.test.tsx`.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--background` | `#FAF8F5` | `#191613` | page |
| `--card` / `--popover` | `#FFFDF9` / `#FFFDF9` | `#23201C` / `#2B2722` | paper; popovers lift by lightness in dark |
| `--muted` / `--secondary` | `#F2EEE8` | `#2B2722` / `#2F2A25` | quiet fills |
| `--foreground` | `#1F1B17` | `#EFE9E1` | text (≥ 14.37 / 11.14 on every surface) |
| `--muted-foreground` | `#5E554C` | `#B8AEA2` | secondary text (≥ 6.13 / 6.15) |
| `--border` | `#E4DED5` | `#3A342E` | **decorative** separators only |
| `--input` = `--border-strong` | `#8F8273` | `#7D7266` | **control boundaries**, ≥ 3:1 on page, card and muted |
| `--primary` (copper) | `#9A4E22` | `#E3A47B` | actions, links, the active item, the focus ring |
| `--primary-hover` / `--primary-pressed` | `#83411B` / `#6C3616` | `#EDB892` / `#F3CBAE` | button states (replace `hover:bg-primary/90`) |
| `--surface-hover` / `--surface-selected` | `#F4F0EA` / `#F6E9DF` | `#2B2722` / `#3A2C22` | row and menu hover; selected row and active nav item |
| `--sidebar` | `#F5F2ED` | `#1E1B17` | the navigation column |
| `--scrim` | charcoal at 55 % | black at 60 % | modal and off-canvas backdrop |
| `--scrim-foreground` | `#FFFDF9` | `#FFFDF9` | an icon on a scrim laid over a user's photograph (avatar, cover image): the scrim is dark in both themes; ≥ 3:1 even over a white photo |
| `--priority-urgent` … `--priority-none` | `#6C3616` `#83411B` `#9A4E22` `#B5683A` `#8F8273` | `#F3CBAE` `#EDB892` `#E3A47B` `#B87A55` `#7D7266` | kanban/ticket priority: a sequential copper ramp, urgent strongest, every step ≥ 3:1 on card, page and muted — **not** a status |
| `--chart-1` … `--chart-5` | `#9A4E22` `#1F6BAE` `#0B7558` `#9C4784` `#946800` | `#E3A47B` `#7FB2EC` `#4FC59F` `#E29BCB` `#E2BC5A` | categorical series |

**One accent.** Copper means "you can act here". `--accent` is no longer a second brand colour: it is the verified teal, equal to `--success`, and is kept only where the meaning is "certificate / verified / signed".

**Status tokens:**

| Meaning | Token (alias) | Light | Dark |
|---|---|---|---|
| current | `--success` (`--status-current`) | `#0E5A52` | `#7CCFC0` |
| attention | `--warning` (`--status-attention`) | `#7A5700` | `#E2BC5A` |
| alarm | `--destructive` (`--status-alarm`) | `#A1282C` | `#F49393` |
| draft / inactive | `--neutral` (`--status-draft`) | `#5A5E66` | `#C3C8CF` |
| informational | `--info` (`--status-info`) | `#2F5B8A` | `#8DB8E8` |

The dashboard warning (hue 43°) is deliberately yellower than the public `#8A5300` (36°): next to copper buttons all day, the public hue was too close to copper's 22°.

**Components use semantic tokens only** — never a palette class, a hex value or a `dark:` colour variant. `src/tests/guards/dashboardColours.p1101.guard.test.ts` fails the build on one, outside the reviewed allow-list in `src/constants/colourExemptions.ts` (user-chosen data colours, the MFA QR's white ground and a tenant logo's plate). Since ADR-122 Amendment 1 it scans every page and component (`app/**`, `components/**`, the public surface included) and also refuses a gradient across two hues (`from-primary to-accent`); a gradient within one token or into a neutral surface is allowed.

## Status Tones (ADR-122)

Colour cannot separate copper from attention, or current from draft, for a red-green colour-blind reader (simulated ΔE 7). So each tone has a **shape** and an **icon** as well as its text, and the colour is the third channel, not the first. One registry, `frontend/src/lib/statusTone.ts`, maps every domain state to a tone; `Badge` with `tone` renders it.

| Tone | Shape | Icon (lucide) | Examples |
|---|---|---|---|
| alarm | **solid fill**, fill text | `octagon-alert` | Overdue, Non-conformant, Failed, Revoked |
| attention | `/10` tint + 1 px `/40` border | `triangle-alert` | Due soon, In transit, Pending approval, Maintenance |
| current | `/10` tint, no border | `circle-check` | Current, Active, Completed, Valid |
| draft | transparent, **dashed** 1 px border | `circle-dashed` | Draft, Inactive, Pending |
| info | `/10` tint | `info` | System notices |

Copper never appears in a badge, and a tenant brand never reaches one.

## The Public Palette (ADR-118)

Landing, sign-in, request access, invitation, activation, verification, blog and news use a separate token set (`--pub-*`, scoped by `data-surface="public"`): warm light (ivory, charcoal, copper; dark teal only as "verified") with a warm dark mode, both with computed contrast ratios in [`20-LANDING-AUTH-REVAMP.md`](./20-LANDING-AUTH-REVAMP.md) §4.2. The rules above still hold there: status colour only for status, never colour alone; copper never appears inside a verdict. *(Until ADR-118 this section described a dark-only set with the teal `#00DAB4` accent.)*

## Light, Dark and the Device (ADR-122)

One mechanism for both surfaces: `localStorage` `hdc-theme-preference`, the `.dark` class and `data-theme-choice` on `<html>`, set before paint by the nonce'd `ThemeInitScript`. **Until the user chooses, both surfaces follow the device's `prefers-color-scheme`.** A choice made on either surface carries to the other; "Use device setting" in the dashboard's user menu clears it.

## Adding a Colour

1. Is it status? Then it must be one of the five existing semantics. A sixth status meaning needs a design decision, not a new hex value.
2. Is it brand? Then it must not collide with any status hue.
3. Check contrast in **both** themes.
4. Check it is not the only carrier of the meaning.
5. Check it survives greyscale if it can reach a PDF.
