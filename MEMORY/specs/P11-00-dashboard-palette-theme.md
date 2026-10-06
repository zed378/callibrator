# Feature Spec — P11-00 The Dashboard Follows the Warm Palette; One Light/Dark Mechanism Everywhere

> **Owner answers, 2026-10-06** (asked by the coordinating session as multiple-choice; all four recommended options chosen): **Q1 Warm neutral** · **Q2 Copper primary** · **Q3 Warm colour-blind-safe chart set** · **Q4 Follow the device until the user chooses**. P11-01 … P11-07 are unblocked. The Phase 11 ADR is **ADR-122**, because ADR-121 was taken by the `POST /sop` contract decision.

**Written:** 2026-10-05, **before** implementation. No code has changed.
**Task:** P11-00 (planning). It opens P11-01 … P11-07.
**Author:** ArchitectUX planning lane, under the owner's delegation. This lane did not touch code, tests or packages.
**Spec refs:**
- `docs/UI-UX/00-DESIGN-DIRECTION.md`, `08-COLOR-SYSTEM.md`, `17-ACCESSIBILITY.md`
- `docs/UI-UX/research/01-current-ui-audit.md` §5.3, §7.2
- `docs/UI-UX/research/02-standards-and-benchmarks.md` §2.2
- `docs/UI-UX/research/03-personas-and-flows.md` §7
- ADR-090 and its amendment (the contrast rule; tenant brand per theme)
- ADR-118 with Amendments 1–3 (the warm public palette, the warm dark mode, the shared theme mechanism)
- `MEMORY/records/2026-10-05-logo-warm-recolour.md`
- `MEMORY/records/2026-10-05-landing-warm-redesign.md`
- `frontend/src/app/public-surface.css`, `frontend/src/app/globals.css`

**Owner instruction (2026-10-05, Indonesian, paraphrased by the coordinator):** "When the landing redesign is finished, continue to Phase 11 to bring the dashboard in line with the colour palette. Make sure there is a dark/light mode button on both the landing page and the dashboard."

This is the go-ahead for Phase 11, **scoped to the palette and the theme**. Density, sidebar regrouping, role homes and the list/form patterns stay on hold (§9).

---

## 0. Decisions for the Owner

Four questions. Each has a recommended option and a one-line trade-off per option. The recommended option is what P11-01 builds if the owner answers "as recommended". The token map in §4 is written for the recommended answers. §4.5 says what changes for each other answer.

### Q1 — How warm should the dashboard be?

| | Option | Trade-off |
|---|---|---|
| **A (recommended)** | **Warm neutral.** Off-white warm page (`#FAF8F5`), near-white paper cards, charcoal text, copper actions. Clearly the same family as the landing, but quieter. | Reads as one product, and stays calm over an 8-hour shift. It is not a pixel match to the landing's ivory. |
| B | **Full public warmth.** The landing's ivory page and cream panels exactly (`#FBF7F0` / `#F4ECDF`). | Strongest continuity. But copper text on its own tint over cream is **4.19:1, which fails AA**, and the yellow cast muddies status tints in dense tables. |
| C | **Cool neutral kept.** Today's slate greys; only the primary and the logo turn copper. | Cheapest. But the landing and the dashboard are two visual systems one click apart. |

### Q2 — What colour is the primary action (buttons, links, the active menu item, focus)?

| | Option | Trade-off |
|---|---|---|
| **A (recommended)** | **Copper** (`#9A4E22` light / `#E3A47B` dark). The landing's own CTA colour. | Continuity with the landing and the logo. Under red-green colour blindness, copper is close to the warning and danger hues (simulated ΔE 7–9). The non-colour channels in §5 must carry status, and they already must (doc 08). |
| B | **Dark teal** (`#0E5A52`). | Calm and clinical. But dark teal is the public "verified" marker. On the dashboard it would also be "compliant" (success), so every button would look like a status. |
| C | **Charcoal ink** (`#2B251F` buttons, copper only for links, focus and the active menu item). | The most neutral enterprise look, and it collides with no status (ΔE ≥ 19). But it is less warm, and primary buttons look heavier. |

### Q3 — Do charts use the warm palette?

| | Option | Trade-off |
|---|---|---|
| **A (recommended)** | **A warm categorical set, chosen for colour blindness.** Copper, blue, green-teal, plum, ochre, in that order. Charts that encode status keep the status colours. Direct labels always. | Matches the palette. The first three series stay distinguishable for red-green colour blindness (simulated ΔE ≥ 24). Series 4 and 5 need a second channel (marker or pattern). |
| B | **Status colours and greys only.** No decorative series colour. | Maximally sober. Multi-series trend charts (e.g. "devices added vs certificates issued") become grey-on-grey. |
| C | **Keep today's colours** (`--primary` blue / `--accent` cyan, Tailwind red/amber/blue in kanban). | No work. But charts would be the one cold element left, and three of the kanban priority colours fail 3:1 today. |

### Q4 — Which theme does a user see before choosing one?

| | Option | Trade-off |
|---|---|---|
| **A (recommended)** | **Follow the device setting (system) until the user chooses.** The landing already does this. The choice is kept in one place and carries both ways (landing ↔ dashboard). A "use device setting" reset sits in the user menu. | One rule for the whole product. Today an unchosen visitor on a dark-mode laptop sees a dark landing and then a light dashboard. |
| B | **Light until chosen**, everywhere: the landing changes to match today's dashboard. | Predictable for screenshots and training material. It ignores a stated user preference, and it changes the landing that ADR-118 Am. 3 just shipped. |
| C | **Dark until chosen**, in the dashboard only. | Suits dim device rooms (doc 00 "Theme"). But it is the one surface that disagrees, and most office users expect light. |

**Not asked, decided here under the owner's delegation, and recorded in the ADR (§8):**
- the exact hex values;
- the status-tone shape grammar (§5);
- the guard (§7.3);
- that tenant branding still overrides `--primary` (ADR-090 amendment, unchanged);
- that `--accent` stops being a second brand colour (§4.3);
- that the toggle stays a two-state button.

The owner asked to be consulted on **direction**, and these are mechanics.

---

## 1. Problem

The public surfaces became warm (ivory, charcoal, copper, verified teal) and gained a warm dark mode on 2026-10-05 (ADR-118 Am. 3). The logo followed (Am. 2). The dashboard did not: it is still slate grey, with trust-blue `#1d4ed8` and clinical cyan `#155e75` (ADR-090). A user who signs in from the warm landing lands in a different, cold product. Its logo is now charcoal and copper, and the logo is the only warm thing on the screen.

The light/dark button exists in both places, but the two do not quite agree:
- the dashboard defaults to light; the public pages follow the system;
- a choice made in the dashboard does not update `data-theme-choice`, which the public CSS reads (D9 below).

Who feels it, by persona (`03-personas-and-flows.md`):
- **all of them** feel the discontinuity;
- the technician (P6, Budi) and the IPSRS user (P8) work in dim device rooms, so they feel the theme default most.

---

## 2. What `docs/` and the ADRs Already Decide (not re-decided here)

| Decision | Source |
|---|---|
| Colour is status, and status is regulatory. The brand accent must not be a status hue. Tenant brand reaches chrome, never status | doc 00 "Colour Carries Meaning", doc 08 |
| Five status meanings: current (green family), attention (amber), alarm (red, overdue/non-conformant only), neutral (grey), informational (blue). A sixth needs a design decision | doc 08 "Status Semantics", "Adding a Colour" |
| Never colour alone: every badge carries text; charts carry direct labels, ≤ 5 colour series, a second channel | doc 08 |
| WCAG 2.1 AA in **both** themes: 4.5:1 text, 3:1 UI and graphics, 3:1 focus | doc 08, doc 17, ADR-090 |
| Dark is not inverted light: dark grey, not black; status hues desaturated and lightened; elevation by lightness | doc 08 "Dark Theme" |
| Components use semantic tokens only — never raw palette classes, never `dark:` colour variants | `globals.css` header comment (ADR-090) |
| A token is read as text on the page, the card and its own `/10` and `/15` tints (light), `/10` (dark) | `a11y.adr090.test.tsx`, `lib/brandColor.ts` |
| A tenant's brand colour is derived per theme to meet that rule; `THEME_SURFACES` mirrors `globals.css` and a test fails on drift | ADR-090 amendment, `brandColor.ts`, `brandColor.test.ts` |
| One theme mechanism: `localStorage` `hdc-theme-preference` + `.dark` on `<html>` before paint (nonce'd `ThemeInitScript`) + `data-theme-choice` when chosen | ADR-118 Am. 3 §1 |
| Public tokens (`--pub-*`) are scoped to `[data-surface="public"]` and must not leak into the dashboard; the dashboard tokens are not redefined by `public-surface.css` | ADR-098 §3, P11-00 abuse case, `public-surface.css` header |
| Logo colours: `--logo-ink` / `--logo-accent` in `globals.css` (charcoal + copper light, ivory + light copper dark) | ADR-118 Am. 2 |
| The dashboard spends nothing on impression; motion is a state signal | doc 00 "Two Audiences", "Motion" |

**Where `docs/` is stale. These are deviation-protocol items for P11-01, not quiet edits:**
- `08-COLOR-SYSTEM.md` "The Product's Own Brand" still gives navy `#001250` / teal `#00DAB4` and `text-[#001250] dark:text-white`. ADR-118 Am. 2 replaced both. Its "The Public Palette" section still says "dark-only… brand teal".
- `00-DESIGN-DIRECTION.md` "Theme" still says "the public surfaces are **dark only**". ADR-118 made them warm light with a warm dark mode.
- `research/01` §7.2 lists `accent` (cyan) as "a second brand colour, which the 'neutral plus one accent' direction removes". This spec does that (§4.3).

---

## 3. Audit of the Dashboard's Theming (2026-10-05, working tree on `main` @ `dded70c` + uncommitted)

**Scope counted:**
- `frontend/src/app/dashboard/**`: 242 non-test `.ts`/`.tsx` files, 60 `page.tsx`.
- Plus the dashboard-reachable shared components: `components/{layouts,ui,editor,errors,icons,motion}`, `AccessDeniedModal`, `ThemeToggle`, `TenantBrandingProvider`.
- `components/public/**` is excluded: it is ADR-118's.

Counts are `grep` over non-test files. Re-count before quoting.

### 3.1 How colour is defined today

| Layer | As built |
|---|---|
| Tokens | `globals.css` `:root` and `.dark`, mapped into Tailwind 4 by `@theme inline` as `--color-*`. There are **26 colour tokens**: surfaces, text, `border`/`input`/`ring`, `primary`/`secondary`/`accent`, and `success`/`warning`/`destructive`/`info` with foregrounds. Slate neutrals, blue-700 primary, cyan-800 accent |
| Tenant brand | `TenantBrandingProvider` sets `--brand-primary-{light,dark}` and `data-tenant-brand`. `globals.css` then swaps `--primary`. Derived by `lib/brandColor.ts` against a hard-coded copy of the surfaces (`THEME_SURFACES`) |
| Logo | `--logo-ink` / `--logo-accent`, already warm (ADR-118 Am. 2) |
| Dark switch | `@variant dark (&:is(.dark *))`. `.dark` is set on `<html>` by the init script, then kept in sync by `ThemeContext` |
| Charts | **No chart library.** About six hand-built SVG/CSS charts: `sparkline-chart.tsx`, `DashboardCharts.tsx`, `kanban/[projectId]/dashboard/page.tsx`, `stock/components/ReportsTab.tsx`, `metered-billing/page.tsx`, `batch-jobs/page.tsx`. They colour via `var(--primary)` / `var(--accent)`, status tokens, or literal hex (kanban) |

### 3.2 How much is token-driven (the good news)

ADR-090 and F-12 already moved the dashboard onto semantic tokens. **The recolour is therefore mostly a change of token values, not a sweep of 300 files.**

**Semantic token classes: 2,643 uses.** By token:

| Token | Uses |
|---|---|
| `muted-foreground` | 826 |
| `foreground` | 356 |
| `border` | 323 |
| `destructive` | 250 |
| `primary` | 226 |
| `muted` | 177 |
| `success` | 135 |
| `card` | 92 |
| `warning` | 78 |
| `info` | 70 |
| `ring` | 41 |
| `accent` | 36 |

**Alpha-tinted tokens (`bg-x/NN`, `border-x/NN`): 364 uses.** The top five are `bg-destructive/10` 48, `bg-muted/50` 36, `bg-primary/10` 30, `bg-success/10` 23 and `bg-card/50` 23. The contrast rule already covers the `/10` and `/15` tints. The `/5`, `/20`, `/30` and `/50` tints are backgrounds and borders, not text grounds.

### 3.3 Hard-coded colour (what the sweep must touch)

| Kind | Count | Files | Notes |
|---|---|---|---|
| Hex literals | **17** | **8** | All in `kanban/**` (11) and `tenants/**` (5). **12 are user-data defaults or fallbacks** (default project/label colour `#4f46e5`/`#ef4444`/`#94a3b8`; the tenant brand picker default `#4f46e5`). These legitimately stay data, on an allow-list. **5 are a chart palette** (`PRIORITY_COLORS` in `kanban/[projectId]/dashboard/page.tsx`) and must become tokens |
| Tailwind palette classes (`bg-amber-500` …) | **12** | **3** | `layouts/ImpersonationBanner.tsx` 6 (amber), `vendors/components/VendorsTable.tsx` 4, `calibration/components/RecordCalibrationModal.tsx` 2 |
| `dark:` variants | **6** | **5** | `dashboard/page.tsx` 2 (decorative blobs), `ImpersonationBanner.tsx`, `motion/AuroraBackground.tsx`, `components/activity-timeline-item.tsx`, `components/quick-action.tsx` |
| `white`/`black` utilities | **48** | **29** | Of these: `text-white` 11; `bg-black/50`–`/80` overlays (scrims) 19 in 16 files (every modal and the mobile sidebar); `bg-white` 8; `bg-white/5`–`/95` 6; `border-white` 4 |
| Faded token text/icons (`text-muted-foreground/NN`) | **8** | **6** | Text: `NotificationBell` timestamp `/70` = **3.59:1 light, 3.56:1 dark (fails 4.5)**. Icons: `/30`–`/60` (empty-state icons, decorative; the sidebar chevrons `/60` are 2.88:1 light) |
| Gradients | **20** | **7** | `DashboardStats.tsx` 12, `stat-card.tsx` 2, `page.tsx` 2, others 1 each. Token-based. They go with the home redesign, not the palette |
| Arbitrary colour values (`bg-[#…]`), `rgb()/hsl()` in TSX | **0** | — | |
| Local status→colour maps | **30 files** | | e.g. `DevicesTable`, `CertificatesTable`, `WorkOrdersTable`, `TransfersTable`, `qms`, `risk`, `tickets/ticketBadges`, `kanban/SprintBar`. Research 01 §5.3: `warning` means six different things, `danger` three |

### 3.4 Light/dark mechanism and the toggle

| Item | As built | Note |
|---|---|---|
| Storage | `localStorage` `hdc-theme-preference` = `light` \| `dark` | shared with the public pages (ADR-118 Am. 3) |
| Pre-paint | root `layout.tsx` inline script (nonce'd): `.dark` if `dark`; `data-theme-choice` if either value is stored | — |
| Dashboard default | `ThemeContext.getInitialTheme()` → **light** when nothing is stored | the public pages follow `prefers-color-scheme` when nothing is stored |
| Dashboard toggle | `components/ThemeToggle.tsx` in `TopBar` (right cluster: search, bell, **toggle**, avatar). Visible at every width | 32 × 32 px (`p-2` + 16 px icon); English-only `aria-label`/`title`; no `aria-pressed`; the sun glyph uses `text-warning` (a status colour used decoratively) |
| Public toggle | `PublicThemeToggle.tsx`: 44 × 44, `aria-pressed`, bilingual name; header, mobile menu, auth shell | writes `.dark` **and** `data-theme-choice` |

### 3.5 Contrast and correctness defects found (current tree)

Ratios are computed (WCAG 2.x relative luminance) from the shipped values. jsdom has no layout, so these were not seen by axe. The browser a11y sweep (`automate/a11y.browser.js`, light + dark) does not open these modals or dropdowns.

| # | Defect | Where | Measured |
|---|---|---|---|
| D1 | Form inputs hard-coded `bg-white text-foreground` → near-white text on white in dark mode | `tenants/[tenantId]/backup/components/BackupCreateModal.tsx` (5 inputs) | **1.23:1** dark |
| D2 | Dialog heading `text-white` on `bg-background` → invisible in light mode | `tenants/components/SsoSettingsPanel.tsx` h2 | **1.04:1** light |
| D3 | Dropdown panel `bg-white/95 text-foreground` → light text on white in dark mode | `components/ui/SearchableDropdown.tsx` | **1.12:1** dark |
| D4 | Control boundaries: `--input` equals `--border` (`#e2e8f0` / `#334155`), so an input outline is the only cue on a same-colour surface | every `ring-input` / `border-input` field | **1.23:1** light, **1.41:1** dark (WCAG 1.4.11 needs 3:1) |
| D5 | Kanban priority chart colours on white | `kanban/[projectId]/dashboard/page.tsx` | urgent 3.76, medium 3.68, **high 2.15, low 2.56, none 1.48** (needs 3:1) |
| D6 | White text on the default label grey | `ManageBoardModal.tsx`, `CardTile.tsx` | **2.56:1** |
| D7 | Faded timestamp text | `NotificationBell.tsx` `text-muted-foreground/70` | **3.59 / 3.56** |
| D8 | Impersonation banner `text-amber-700` on `bg-amber-500/15` | `ImpersonationBanner.tsx` | **4.47** light (just under) |
| D9 | The dashboard toggle writes `localStorage` and `.dark` but not `data-theme-choice`. After choosing **light** in the dashboard on a dark-preference device, a client-side navigation to `/` still shows the public pages dark (they follow the system when no choice attribute is set). A full reload fixes it | `contexts/ThemeContext.tsx` `toggleTheme` | — |
| D10 | An unchosen visitor on a dark-preference device: a dark landing → sign in → a light dashboard | `ThemeContext.getInitialTheme` vs `public-surface.css` | owner Q4 |
| D11 | The toggle target is 32 px; its name is English-only; there is no `aria-pressed` | `ThemeToggle.tsx` | 2.5.8 (24 px) is met; parity with the public 44 px is not |

D1–D3 and D5–D8 are **existing accessibility defects** whatever the palette answer. They are fixed by P11-03 (D3, D7, D8), P11-04 (D1, D2, D6) and P11-06 (D5); D4 by P11-01 (the `--input` value); D9–D11 by P11-02.

---

## 4. The Proposed Dashboard Colour System

### 4.1 Principles

1. **Same family as the landing, not the same page.**
   - Light theme: warm neutral surfaces (a paper card on a slightly darker warm page), charcoal ink, copper actions.
   - Dark theme: espresso surfaces, ivory ink, light copper.
   - The values are the public palette's, tempered for density: no grain texture, no serif, no cream panels under tables.
2. **Neutral surfaces carry the data. Copper means "you can act here". Status hues mean status.** Copper is never a status. Status is never copper.
3. **One accent** (copper). Teal is the "verified / compliant" state, as on the public pages (`--pub-verified` = `--pub-success`).
4. **Every pair is computed, and the tests compute it again.** No ratio in this document is a judgement.
5. **The token names do not change.** The 2,643 existing uses recolour by themselves. New tokens are additive.

### 4.2 Token map — existing tokens (recommended answers Q1-A, Q2-A)

**How the ratios were computed:**
- WCAG 2.x contrast, computed for this spec (script method identical to `a11y.adr090.test.tsx`).
- "Text min" is the lowest of: on the page, on the card, and on its own `/10` and `/15` tint over each. This is ADR-090's rule; dark also passes at `/15`.
- "On fill" is the `-foreground` value on the token as a solid fill (button, solid badge).

| Token | Today light → dark | **Proposed light** | **Proposed dark** | Light ratios | Dark ratios |
|---|---|---|---|---|---|
| `--background` (page) | `#f8fafc` → `#0f172a` | **`#FAF8F5`** warm off-white | **`#191613`** espresso | — | — |
| `--card` | `#ffffff` → `#1e293b` | **`#FFFDF9`** paper | **`#23201C`** | — | — |
| `--popover` | `#ffffff` → `#1e293b` | **`#FFFDF9`** | **`#2B2722`** (lifted: elevation by lightness) | — | — |
| `--muted` | `#f1f5f9` → `#1e293b` | **`#F2EEE8`** | **`#2B2722`** | — | — |
| `--foreground`, `--card-foreground`, `--popover-foreground` | slate-900 → slate-200 | **`#1F1B17`** charcoal | **`#EFE9E1`** ivory | min 14.37 (on selected) · 16.84 on card | min 11.14 (on selected) · 13.45 on card |
| `--muted-foreground` | `#475569` → `#94a3b8` | **`#5E554C`** | **`#B8AEA2`** | min 6.13 (on selected) · 7.18 on card · 6.71 on `muted/50` | min 6.15 · 7.43 on card |
| `--border` (decorative separators) | `#e2e8f0` → `#334155` | **`#E4DED5`** | **`#3A342E`** | 1.32 on card (decorative, exempt) | 1.32 |
| `--input` (**control boundary**) | = border (**1.23 / 1.41, fails**) | **`#8F8273`** | **`#7D7266`** | 3.69 card · 3.53 page · 3.24 muted | 3.45 card · 3.84 page · 3.16 muted |
| `--primary` | `#1d4ed8` → `#60a5fa` | **`#9A4E22`** copper (= `--pub-accent`) | **`#E3A47B`** light copper (= `--pub-dark-accent`) | text min **4.58** (copper/15 over page) · 5.93 card | text min 5.66 · 7.62 card |
| `--primary-foreground` | `#ffffff` → `#0f172a` | **`#FFFDF9`** | **`#1A1511`** | on fill 5.93 | on fill 8.51 |
| `--secondary` / `-foreground` | slate-100/800 → slate-700/100 | **`#F2EEE8`** / **`#2B251F`** | **`#2F2A25`** / **`#EFE9E1`** | — | — |
| `--accent` / `-foreground` | cyan-800 → cyan-400 | **`#0E5A52`** / `#FFFDF9` (verified teal) | **`#7CCFC0`** / `#10201D` | text min 5.99 · on fill 7.94 | text min 6.48 · on fill 9.26 |
| `--success` / `-foreground` | `#046c4e` → `#10b981` | **`#0E5A52`** / `#FFFDF9` (= `--pub-success`) | **`#7CCFC0`** / `#10201D` (= `--pub-dark-verified`) | text min 5.99 · on fill 7.94 | text min 6.48 · on fill 9.26 |
| `--warning` / `-foreground` | `#92400e` → `#f59e0b` | **`#7A5700`** ochre / `#FFFDF9` | **`#E2BC5A`** / `#1F1A0B` | text min 5.01 · on fill 6.48 | text min 6.46 · on fill 9.56 |
| `--destructive` / `-foreground` | `#be123c` → `#fb7185` | **`#A1282C`** (= `--pub-danger`) / `#FFFDF9` | **`#F49393`** (= `--pub-dark-danger`) / `#2A0E0E` | text min 5.43 · on fill 7.24 | text min 5.52 · on fill 8.09 |
| `--info` / `-foreground` | `#0369a1` → `#38bdf8` | **`#2F5B8A`** slate blue / `#FFFDF9` | **`#8DB8E8`** / `#0D1B2A` | text min 5.31 · on fill 6.93 | text min 5.80 · on fill 8.41 |
| `--ring` (focus) | = primary | = primary | = primary | 5.68 page · 5.93 card · 5.21 muted · 5.06 selected | 8.46 · 7.62 · 6.96 · 6.31 |
| `--logo-ink` / `--logo-accent` | already warm (Am. 2) | unchanged `#1F1B17` / `#9A4E22` | unchanged `#F6EFE4` / `#E3A47B` | ink 16.84 · accent 5.93 on card, 5.39 on sidebar | 14.20 · 7.62 on card |

**Hover and pressed shades of primary:**
- light: `#83411B` (on-fill 7.55) and `#6C3616` (9.50);
- dark: `#EDB892` (10.24) and `#F3CBAE` (12.05).

They replace `hover:bg-primary/90`, which lightens copper towards the page.

**Why warning moved from the public `#8A5300`.** The public warning's hue is 36°, close to copper's 22°. `#7A5700` (hue 43°) is the most yellow ochre that keeps 5.01:1 on its `/15` tint. In dark, `#E2BC5A` (hue 43°) replaces the public `#F2B55E` (35°) for the same reason. On the public pages the warning hue is rare (status only). In the dashboard it sits next to copper buttons all day.

### 4.3 Token map — new tokens (additive)

| New token | Light | Dark | Purpose / ratios |
|---|---|---|---|
| `--surface-hover` | `#F4F0EA` | `#2B2722` | table row / menu hover. Text 15.07 / 12.30; muted text 6.42 / 6.79 |
| `--surface-selected` | `#F6E9DF` (copper-tinted) | `#3A2C22` | selected row, active nav item. Text 14.37 / 11.14; primary as text 5.06 / 6.31 |
| `--sidebar` | `#F5F2ED` | `#1E1B17` | the navigation column, one step off the card. Text 15.32 / 14.22 |
| `--border-strong` | = `--input` | = `--input` | any non-input control boundary (checkbox, toggle track, segmented control) ≥ 3:1 |
| `--neutral` / `-foreground` | `#5A5E66` / `#FFFDF9` | `#C3C8CF` / `#191613` | the grey "draft / inactive / pending" status (doc 08 has the meaning; there is no token today). Text min 4.98 / 6.83 |
| `--status-current`, `--status-attention`, `--status-alarm`, `--status-draft`, `--status-info` | aliases of success, warning, destructive, neutral, info | same | the domain names research 01 §7.2 asks for, so a tenant brand or a decorative use can never be "the overdue colour" by accident. Consumed only by the status registry (P11-05) |
| `--chart-1` … `--chart-5` | copper `#9A4E22`, blue `#1F6BAE`, green-teal `#0B7558`, plum `#9C4784`, ochre `#946800` | `#E3A47B`, `#7FB2EC`, `#4FC59F`, `#E29BCB`, `#E2BC5A` | categorical series (Q3-A). Each ≥ 3:1 on card and page: light 4.67–5.93, dark 7.32–9.93 |
| `--scrim` | `rgb(31 27 23 / 0.55)` | `rgb(0 0 0 / 0.6)` | modal/off-canvas backdrop; replaces 19 `bg-black/NN` |

**`--accent` stops being a second brand colour.** It becomes the verified teal, the same value as success.
- Its 36 uses are in 10 files: home stats and quick actions, `stat-card`, `TenantBreakdown`, menu-groups `SummaryStats`, storage, `UserRow`, `Avatar`, `AuroraBackground`, and the "Certificates Issued" sparkline.
- P11-04 reviews each one. "Certificate / verified / signed" keeps `accent`; everything else moves to `primary`, a `--chart-n`, or neutral.
- The name is kept, so nothing breaks in between: the worst interim state is a decorative tile in calm teal.

### 4.4 Colour blindness (simulated, Machado 2009, severity 1.0; CIELAB ΔE76; < 10 ≈ hard to tell apart, > 20 clearly distinct)

| Pair (light) | Normal | Deutan | Protan | Tritan |
|---|---|---|---|---|
| current (teal) ~ alarm (red) | 79 | 37 | **17** | 93 |
| attention (ochre) ~ alarm | 46 | **14** | 29 | 42 |
| current ~ draft (grey) | 25 | **7** | **8** | 22 |
| copper (primary) ~ attention | 23 | **7** | **10** | 22 |
| copper ~ alarm | 24 | **9** | 20 | 21 |
| info ~ draft | 26 | 28 | 24 | 21 |

Dark is similar (current~draft deutan 4; copper~alarm deutan 13).

**Conclusion:** no palette that keeps a warm accent *and* AA text contrast separates these four by hue alone for red-green colour blindness.
- Teal success is already the best case for the alarm pair: teal keeps a blue component, so it never collapses into red the way a pure green does.
- The remaining separation must be **non-colour**, which doc 08 already requires. §5 makes it systematic.

### 4.5 If the owner answers differently

| Answer | Change to §4.2–4.3 |
|---|---|
| Q1-B (full warmth) | `--background #FBF7F0`, `--muted`/`--secondary #F4ECDF`, `--card #FFFDF8`. Copper must darken to about `#8E471F` for its `/15` tint over cream (copper is 4.19:1 there today), so the dashboard primary would no longer equal `--pub-accent` |
| Q1-C (cool kept) | Surfaces and neutrals stay slate. Copper still passes (5.76 on `#f8fafc`, 4.64 on its `/15`; dark copper 6.87 on `#1e293b`). Status values as proposed |
| Q2-B (teal primary) | `--primary #0E5A52` / `#7CCFC0`. Success must then move to a distinct green-teal and `--accent` to copper. The status/action collision moves from copper~warning to teal~success (ΔE 0 by construction). Not recommended |
| Q2-C (charcoal primary) | `--primary #2B251F` / fill text `#FFFDF9` (14.90); dark `--primary #EFE9E1` / text `#1A1511` (15.02). Copper stays for `--ring`, links (new `--link`) and the active nav item (`--surface-selected` + copper text). Status collisions ≥ 19 ΔE |
| Q3-B | `--chart-*` = neutral ramp; only status charts are coloured |
| Q3-C | no `--chart-*`; D5 is still fixed with status tokens |
| Q4-B / Q4-C | the init script and `PublicThemeToggle.effectiveDark` change their fallback; the CSS changes in `public-surface.css` (`html:not([data-theme-choice])` rule) |

---

## 5. Status Tones: Colour Plus a Second Channel (CVD-safe by construction)

One registry, `lib/statusTone.ts` (P11-05), replaces the 30 local maps. Each domain state maps to a **tone** (one of five). Each tone has a fixed **shape**, **icon** and **label**. The colour is the third channel, not the first.

| Tone | Token | Badge shape | Icon (lucide) | Examples (doc 08) |
|---|---|---|---|---|
| alarm | `--status-alarm` | **solid fill**, fill text (`-foreground`) | `octagon-alert` | Overdue, Non-conformant, Failed, Revoked |
| attention | `--status-attention` | tinted `/10` + 1 px border `/40` | `triangle-alert` | Due soon, In transit, Pending approval |
| current | `--status-current` | tinted `/10`, no border | `circle-check` | Current, Active, Completed, Valid |
| draft | `--status-draft` | **transparent, dashed 1 px border** | `circle-dashed` | Draft, Inactive, Pending |
| info | `--status-info` | tinted `/10` | `info` | System notices |

Three channels separate the pairs that colour cannot:
- **Shape:** fill vs tint vs dashed outline.
- **Icon silhouette:** octagon, triangle, circle-check, dashed circle.
- **Text:** the badge's label.

So *Current* (tinted, check) and *Draft* (dashed outline, dashed circle) differ for a deutan viewer, and so do *Overdue* (solid, octagon) and *Due soon* (tinted, triangle). They also survive greyscale print (doc 08 "Print and PDF").

**Other status rules:**
- Priority (kanban urgent/high/medium/low) is **not** a status. It is a sequential copper ramp with labels, never the alarm red. Research 01 §5.3 found `danger` diluted by "high priority".
- Device `maintenance` is attention, not alarm (doc 08).
- Copper never appears in a badge.

---

## 6. Theme Mechanism and the Toggle (the owner's "button on both")

**What exists:**
- a toggle on both surfaces;
- one store (`hdc-theme-preference`);
- one class (`.dark`);
- one pre-paint script.

**What P11-02 changes:**

1. **One write path.** `ThemeContext.toggleTheme` calls the same `applyTheme` that `PublicThemeToggle.tsx` exports. It sets `.dark`, `data-theme-choice` and storage, and fires the same event. This fixes D9. `ThemeContext` subscribes to that event, so a choice made in another tab or on a public island is reflected.
2. **One default** (Q4). With Q4-A, `ThemeContext.getInitialTheme` returns the system theme when nothing is stored, matching the init script and `public-surface.css`. The init script also sets `.dark` from `prefers-color-scheme` when nothing is stored, so the dashboard has no flash. A "Use device setting" item in the user menu clears the choice. That menu does not exist yet (research 01 S-row "no user menu"), so until then the profile page carries it.
3. **One toggle look.**
   - The dashboard `ThemeToggle` keeps its place in the `TopBar` right cluster, between the notification bell and the avatar.
   - It becomes 40 × 40 px: the dense chrome's control height, over WCAG 2.2's 24 px. The public one stays 44.
   - It gains `aria-pressed` ("Dark mode", pressed when dark), the same glyphs, and an `aria-label` from the dictionary when the dashboard gets ID/EN (P11-08, a later card). Until then it is English, as the rest of the dashboard is (doc 00 "Language").
   - The sun glyph stops using `text-warning`: a status colour is never decoration.
4. **Continuity tests:**
   - choose dark on `/` → open `/dashboard` → still dark;
   - choose light in the dashboard → client-navigate to `/` → light;
   - nothing stored + `prefers-color-scheme: dark` → both dark (Q4-A).
   The first two as jest (jsdom: storage and attributes); all three in `automate/p10.browser.mts` or a new `p11.browser.mts`.

**Explicitly unchanged:** the storage key, the nonce'd script, `ThemeInitScript`, and the rule that public pages mount no client providers (ADR-098 Am. 2).

---

## 7. Migration Plan

**Order:** token layer → theme mechanism → shell → modules → status registry → charts → verification. Each step leaves the app shippable in both themes.

### 7.1 Keep it mechanical

- **Change values, not names.** P11-01 edits only `globals.css`'s `:root` / `.dark` blocks plus the new additive tokens. 2,643 class uses follow without an edit.
- **Mirror files move in the same commit:**
  - `lib/brandColor.ts` `THEME_SURFACES` (the new page/card/muted). `brandColor.test.ts` fails if it is forgotten;
  - `a11y.adr090.test.tsx`: it reads `globals.css`, so the test needs no value edits, only the new pairs in §7.3;
  - the `BrandIcon.p1017` dashboard-card assertions (`#1e293b` → `#23201C`);
  - `TenantBrandingProvider.test.tsx` and `brandColor.adr090.test.tsx`, which embed today's surfaces.
- **Codemod-able replacements for the module sweep (P11-04)**, each a one-line class swap reviewed per file:

| From | To |
|---|---|
| `bg-black/50`, `bg-black/60` (scrims) | `bg-scrim` |
| `bg-white text-foreground` (inputs) | `bg-card` (+ `border-input`) |
| `text-white` on a token fill | the fill's `-foreground` |
| `text-white` heading | `text-foreground` |
| `bg-amber-500/15 text-amber-700 dark:text-amber-300` | `bg-warning/10 text-warning` |
| `hover:bg-primary/90` | `hover:bg-primary-hover` |
| `text-muted-foreground/70` on text | `text-muted-foreground` |
| `ring-input` borders | unchanged class, new value |

- **What is not mechanical:** the 30 status maps (P11-05), the 36 `accent` uses (P11-04, a reviewed choice per use), and the kanban priority ramp (P11-06).
- **Out of scope for the palette cards:** gradients, hover lifts and the home hero's decorative blobs. They are redesign (home, motion). P11-04 only re-tokenises them if they carry a raw colour.

### 7.2 Batch order: P11-03 (shell and primitives), then P11-04 (modules)

Batches in order of traffic and defect weight. Each batch is one commit with before/after screenshots in both themes:

1. **P11-03 — Shell + `components/ui`:**
   - `Sidebar`, `TopBar`, `DashboardLayout`, `ImpersonationBanner`, `NotificationBell`, `UserDropdown`;
   - `Dialog`, `SearchableDropdown` (D3), `ToastContainer`, `Button` (hover shade), `Avatar`;
   - `AccessDeniedModal`.
2. **P11-04 batch 1 — Equipment and calibration:** devices, calibration (incl. `RecordCalibrationModal` palette classes), calibration-scheduler, certificates, maintenance.
3. **P11-04 batch 2 — Warehouse and stock**, vendors (`VendorsTable` palette classes).
4. **P11-04 batch 3 — Organisation:** tenants (D1, D2, the brand picker allow-list), users (`EditModal`), roles, sessions.
5. **P11-04 batch 4 — Work:** kanban (D6; D5 is P11-06), tickets, e-signature, QMS, risk.
6. **P11-04 batch 5 — The rest:** content, billing, metered billing, batch jobs, API keys, webhooks, storage, custom domains, profile, MFA (the QR keeps `bg-white`: a QR needs dark-on-light in both themes, allow-listed like `.lp-paper`).

### 7.3 Guards (so it stays fixed)

1. **`dashboardColours.p1101.guard.test.ts`** (jest, `src/tests/guards/`), a scan over `app/dashboard/**` and `components/{layouts,ui,editor,errors,icons,motion}` plus `AccessDeniedModal`, `ThemeToggle` and `TenantBrandingProvider`. It fails on:
   - hex literals `#rgb`/`#rrggbb`, and `rgb(`/`rgba(`/`hsl(`/`oklch(` in `.ts`/`.tsx`;
   - Tailwind palette colour classes (`(bg|text|border|ring|fill|stroke|from|via|to|outline|divide|decoration|shadow|placeholder|caret|accent)-(slate|gray|zinc|neutral|stone|red|…|rose)-\d{2,3}`);
   - `(bg|text|border|…)-(white|black)` utilities;
   - arbitrary colour values `-[#`, `-[rgb`, `-[color:`;
   - `dark:` followed by a colour utility;
   - text-bearing `text-*-foreground/NN`.
2. **It ships in P11-01 as a ratchet.** The baseline is the counts in §3.3 per file; the test fails if any file's count rises. Each P11-03 and P11-04 batch lowers the baseline, and P11-04 ends at **zero outside the allow-list**.
3. **The allow-list is reviewed and in code** (`constants/colourExemptions.ts`, the same idea as `routeGateExemptions.ts`): the file, the literal, and a one-line reason. The expected entries are:
   - user-chosen data colours: kanban project/label defaults and fallbacks, and the tenant brand picker default;
   - the MFA QR's `bg-white`.
4. **The guard tests itself.** A fixture file with one of each forbidden form must fail. This is not "a test generated from the code it tests" (CLAUDE.md Evidence): the patterns are written independently of the sweep.
5. **`a11y.adr090.test.tsx` grows the pairs this spec computes:**
   - `--input` ≥ 3:1 on page/card/muted;
   - `--ring` ≥ 3:1 on page/card/muted/selected;
   - `--neutral` as text on its tints;
   - `--chart-1..5` ≥ 3:1 on card and page;
   - foreground and muted-foreground ≥ 4.5 on hover/selected/sidebar;
   - primary-hover/pressed fill text ≥ 4.5.
   The test reads `globals.css`, as it does today, so a value change cannot drift from the table.
6. **Optional, later:** an ESLint rule that does the same on save. The jest guard is the gate; ESLint over template-literal class strings is brittle.

### 7.4 Verification (P11-07)

- `npm run typecheck`, `npx eslint` on every changed file, full frontend jest with coverage (gate 90/81/86/91), `next build`, and the bundle budget (unchanged ceilings).
- The browser a11y suite (`automate/a11y.browser.js`, light **and** dark over the dashboard routes, today 80/80) on a production build. **Plus** the modal/dropdown states the sweep does not open: the D1–D3 screens. They are added to the suite, because that is where the defects hid.
- Screenshots, before/after, light/dark, of:
  - the shell;
  - each P11-04 batch's main list, one modal and one form;
  - the status badge set;
  - the home charts.
  Kept in `docs/UI-UX/research/screens/p11-*`.
- The live E2E smoke on the disposable stack (`make test-e2e` is not needed for a token change; the smoke 7/7 is).

---

## 8. The ADR P11-01 Must Write

**ADR-122**. Title: "The dashboard follows the warm palette; one theme default and write path; status tones carry shape and icon".

It records:
- the owner's Q1–Q4 answers;
- §4's values and ratios;
- §5's grammar;
- §6's mechanism;
- the guard.

**Alternatives considered:** Q1–Q4's other options, with §4.5's numbers.

**Bad implications:**
- copper is near warning/alarm for red-green colour blindness (§4.4), and shape and icon carry status;
- every tenant without a brand colour gets copper buttons;
- the logo, the public CSS and `globals.css` now share copper in three places (ADR-118 Am. 2 already had two);
- screenshots in docs and the landing's product shots show the old slate dashboard until re-captured.

**Amends:**
- doc 08: the brand section, the public section, the new tokens and the status-tone grammar;
- doc 00: the "Theme" paragraph;
- doc 06 and doc 10: the badge component;
- doc 17: control boundaries.

---

## 9. Scope Boundaries

**In Phase 11's palette-and-theme scope (P11-01 … P11-07; card list in `TASKS/PHASE-11-DASHBOARD-REVAMP.md`):**
- token values;
- new tokens;
- the theme mechanism and toggle;
- the shell's colours;
- the hard-coded-colour sweep with D1–D8;
- the status registry;
- chart colours;
- guards;
- verification.

**Explicitly not in it** (they need owner input and keep their research):

| Later card | Why it waits |
|---|---|
| Dashboard language ID/EN | needs the `next-intl` vs Phase 10 dictionaries decision |
| Density tokens and floorplans | owner direction (research 01 §7.2–7.3, 02 §1.6) not confirmed |
| Shell: domain-grouped collapsible sidebar, page title, breadcrumb, tenant indicator, user menu | IA decision (research 03 §6) |
| Role homes | research 03 §7 Q1–Q4 open |
| List / object-page / form patterns (DataGrid, FilterBar, PageHeader…) | large, depends on density and shell |
| Typography: whether the dashboard adopts Plus Jakarta Sans / a serif display face | a direction question. The palette works with Inter |
| Motion: hover lifts, home animation | doc 00 already rules on it; it goes with the home redesign |

**Abuse cases:**
- Using `--pub-*` tokens or `[data-surface="public"]` in the dashboard to "get the warm look fast". ADR-098 forbids it, and it would bring the grain texture and 44 px public controls into dense UI.
- Lowering a contrast threshold or deleting a pair from `a11y.adr090.test.tsx` to make a value pass.
- Growing the colour allow-list to pass the guard instead of fixing the file.
- Re-colouring status by tenant brand, or using copper inside a status badge.
- Calling P11-04 done because the guard is green while the accent review (36 uses) was skipped.
- Starting density, sidebar regrouping or role homes under the cover of "palette".

---

## 10. Traps (frontend-specific, from this tree)

| Trap | What happens |
|---|---|
| Changing `globals.css` surfaces without `lib/brandColor.ts` `THEME_SURFACES` | tenant brands are derived against the old surfaces. `brandColor.test.ts` fails, and must not be "fixed" by editing the test |
| A `dark:` colour variant to patch one screen | it bypasses the token layer, and the guard fails |
| `color-mix()` / alpha tints used as **text** grounds beyond `/15` | unverified contrast. Add the pair to the test or don't |
| A Next 16 client component reading `localStorage` in render for the theme | hydration mismatch. Use the event/`useSyncExternalStore` pattern `PublicThemeToggle` uses |
| Forgetting `data-theme-choice` in a new write path | D9 again |
| Disabling a React Compiler lint rule to make the toggle build | CLAUDE.md forbids it. The rule is usually right |
| An inline `<style>` for theme variables | CSP nonce rule (ADR-071): put tokens in `globals.css` |

---

## Appendix — Indonesian Version of the Four Questions (for relay to the owner)

**Q1 — Seberapa "hangat" dashboard?**
- **A (disarankan):** netral hangat — latar putih-gading lembut, kartu kertas, teks arang, tombol tembaga. Satu keluarga dengan landing, tetapi lebih tenang untuk kerja seharian.
- B: persis seperti landing (gading/krem). Paling serasi, tetapi teks tembaga di atas krem gagal kontras AA (4,19:1) dan warna status di tabel jadi keruh.
- C: tetap abu-abu dingin, hanya tombol dan logo yang tembaga. Paling murah, tetapi landing dan dashboard terasa dua produk.

**Q2 — Warna tombol/aksi utama?**
- **A (disarankan):** tembaga, seperti CTA landing. Konsisten. Untuk buta warna merah-hijau, tembaga mirip warna peringatan/bahaya, jadi status wajib memakai bentuk + ikon + teks.
- B: teal gelap. Tenang, tetapi teal adalah tanda "terverifikasi/sesuai", sehingga setiap tombol terlihat seperti status.
- C: arang (hitam hangat), dengan tembaga hanya untuk tautan/fokus/menu aktif. Paling netral dan tidak bentrok dengan status, tetapi kurang hangat.

**Q3 — Warna grafik?**
- **A (disarankan):** palet hangat yang aman untuk buta warna (tembaga, biru, hijau-teal, ungu, oker). Grafik status tetap memakai warna status, dan selalu dengan label langsung.
- B: hanya warna status + abu-abu. Sangat sober, tetapi grafik multi-seri jadi abu-abu semua.
- C: biarkan seperti sekarang. Tanpa kerja, tetapi grafik jadi satu-satunya elemen dingin, dan 3 warna prioritas kanban gagal kontras.

**Q4 — Tema awal sebelum pengguna memilih?**
- **A (disarankan):** ikuti pengaturan perangkat (sistem), sama seperti landing; pilihan pengguna berlaku di landing dan dashboard; ada opsi "ikuti perangkat" di menu pengguna.
- B: selalu terang sampai dipilih (landing ikut berubah).
- C: gelap sampai dipilih, hanya di dashboard.
