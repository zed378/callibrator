# Phase 11 — Admin Dashboard Revamp

> **Owner answers, 2026-10-06** (asked by the coordinating session as multiple-choice; all four recommended options chosen): **Q1 Warm neutral** · **Q2 Copper primary** · **Q3 Warm colour-blind-safe chart set** · **Q4 Follow the device until the user chooses**. P11-01 … P11-07 are unblocked. The Phase 11 ADR is **ADR-122**, because ADR-121 was taken by the `POST /sop` contract decision.

**Status:** ▶ **Palette and theme scope OPENED by the owner (2026-10-05).** The rest stays on hold.
- **Open:** P11-00 planning is DONE, pending the owner's answers to four questions. P11-01 … P11-07 wait for those answers.
- **Still on hold:** density, sidebar regrouping, role homes, list/form patterns, language and typography (P11-08 …). Each is BLOCKED, awaiting owner input.
- **Planned:** 2026-09-29 as a placeholder; re-planned 2026-10-05.
- **Spec:** [`../MEMORY/specs/P11-00-dashboard-palette-theme.md`](../MEMORY/specs/P11-00-dashboard-palette-theme.md).
- **Decision record:** the Phase 11 ADR (ADR-122) is written in P11-01 once the owner has answered.

**Owner instruction (2026-10-05, Indonesian, paraphrased):** "When the landing redesign is finished, continue to Phase 11 to bring the dashboard in line with the colour palette. Make sure there is a dark/light mode button on both the landing page and the dashboard."

This opens Phase 11 for **the palette and the theme only**: ADR-118's warm palette and its warm dark mode, applied to the dashboard, plus one light/dark mechanism across both surfaces. The larger redesign that the research describes is not part of the instruction. It keeps its cards, marked as needing owner input.

**Research already available (inputs, not decisions):**

- [`../docs/UI-UX/research/01-current-ui-audit.md`](../docs/UI-UX/research/01-current-ui-audit.md) — the current dashboard audited menu by menu: shell, menu inventory, page-by-page findings, cross-cutting inconsistencies, heuristic evaluation, design system, top 15 issues
- [`../docs/UI-UX/research/02-standards-and-benchmarks.md`](../docs/UI-UX/research/02-standards-and-benchmarks.md) — Fiori, ServiceNow, Carbon, Atlassian and Salesforce patterns; WCAG 2.1 AA in dense tables and forms; 21 CFR Part 11 and ISO/IEC 17025 as UI; ID/EN locale formats; a prioritised pattern library (§6)
- [`../docs/UI-UX/research/03-personas-and-flows.md`](../docs/UI-UX/research/03-personas-and-flows.md) — role inventory, the effective role → menu matrix, proto-personas, key journeys, role-specific homes, a proposed information architecture, open questions for the owner
- **Theming audit and token proposal:** spec P11-00 §3–§5. It covers:
  - colour definitions and counts;
  - defects D1–D11;
  - the token map with computed contrast;
  - the colour-blindness simulation;
  - the status-tone grammar.

**Owner direction recorded in that research (still to be confirmed for the later cards):**
- enterprise-dense (SAP/ServiceNow-like);
- a collapsible sidebar grouped by domain;
- comfortable density with a compact toggle;
- a home page per role;
- a neutral palette plus one accent (the tenant brand), in light and dark. **This item is now superseded in direction by the 2026-10-05 instruction: the warm palette, with the tenant brand still overriding `--primary`;**
- the existing design system kept and tidied;
- desktop first, tablet usable;
- WCAG 2.1 AA;
- Indonesian and English.

---

## Decisions Awaiting the Owner (from spec P11-00 §0)

Each question offers a recommended option, which P11-01 builds if the owner answers "as recommended".

| # | Question | Recommended |
|---|---|---|
| P11-Q1 | How warm should the dashboard be? A warm neutral · B full public warmth (ivory/cream) · C cool slate kept | **A** |
| P11-Q2 | Primary action colour? A copper · B dark teal · C charcoal ink with copper accents | **A** |
| P11-Q3 | Do charts use the warm palette? A warm, colour-blind-safe categorical set; status charts keep status colours · B status + greys only · C unchanged | **A** |
| P11-Q4 | Theme before the user chooses? A follow the device (as the landing does) · B light everywhere · C dark in the dashboard | **A** |

The verbatim questions, each option's trade-off and an Indonesian version are in the spec.

---

## Cards

| Card | Title | Status |
|---|---|---|
| P11-00 | Owner instruction, scope and plan for the palette and theme; audit; owner questions | **DONE (planning) 2026-10-05 — pending owner answers to P11-Q1…Q4** |
| P11-01 | Token layer: warm dashboard tokens (light + dark), new additive tokens, contrast test pairs, colour guard (ratchet), Phase 11 ADR, amendments to docs 00 and 08 | BLOCKED — awaiting P11-Q1, Q2 (and Q3 for `--chart-*`) |
| P11-02 | One theme mechanism: a shared write path, one default, toggle parity on the landing and the dashboard, continuity tests | BLOCKED — awaiting P11-Q4 |
| P11-03 | Shell and primitives recolour: sidebar, top bar, overlays/scrim, `components/ui` (D3, D7, D8) | BLOCKED — depends on P11-01 |
| P11-04 | Module sweep (5 batches): hard-coded colours to tokens, the `accent` review, D1, D2, D6; the guard reaches zero | BLOCKED — depends on P11-03 |
| P11-05 | Status-tone registry: one map, shape + icon + label + colour; replaces the 30 local maps | BLOCKED — depends on P11-01 |
| P11-06 | Charts: `--chart-*` and status tokens in the hand-built charts; kanban priority ramp (D5); direct labels | BLOCKED — depends on P11-01, P11-Q3 |
| P11-07 | Verification and record: axe light + dark (plus the modal states), screenshots, gates, record | BLOCKED — depends on P11-02 … P11-06 |
| P11-08 | Dashboard language: adopt ID/EN (reuse or migrate Phase 10's dictionaries; the `next-intl` decision) | BLOCKED — **needs owner input** (was placeholder P11-01) |
| P11-09 | Density tokens (comfortable / compact) and the page floorplans | BLOCKED — **needs owner input** (was P11-02) |
| P11-10 | Shell structure: domain-grouped collapsible sidebar, page title and breadcrumb, tenant indicator, user menu | BLOCKED — **needs owner input** (was P11-03) |
| P11-11 | Role homes (worklist vs overview) | BLOCKED — **needs owner input**; research 03 §7 Q1–Q4 (was P11-04) |
| P11-12 | List, object-page and form patterns across modules (DataGrid, FilterBar, PageHeader, Tabs, Drawer) | BLOCKED — **needs owner input** (was P11-05) |
| P11-13 | Dashboard typography: whether it adopts the public faces | BLOCKED — **needs owner input** (new; out of the palette scope on purpose) |
| P11-14 | Accessibility, performance and live E2E verification of the redesign (P11-08 … P11-13) | BLOCKED — **needs owner input** (was P11-06) |

**Renumbering note:** the placeholder cards of 2026-09-29 (P11-01 … P11-06) are now P11-08 … P11-12 and P11-14, with unchanged titles. They were placeholders with no DoD, so nothing that referenced them is invalidated.

---

### P11-00 — Owner instruction, scope and plan for the palette and theme

| | |
|---|---|
| **Status** | **DONE (planning) 2026-10-05 — pending owner answers to P11-Q1…Q4** |
| **Depends on** | the owner's go-ahead (given 2026-10-05) |
| **Spec refs** | docs/UI-UX/00-DESIGN-DIRECTION.md · 08-COLOR-SYSTEM.md · 17-ACCESSIBILITY.md · research 01–03 · ADR-090 · ADR-118 Am. 1–3 |
| **Spec required** | yes — [`MEMORY/specs/P11-00-dashboard-palette-theme.md`](../MEMORY/specs/P11-00-dashboard-palette-theme.md) |

**Why:** the dashboard is where operators work every day. A palette change there touches every module, and it changes documents every module follows (00, 06, 08, 10, 17). It needs the owner's instruction, a confirmed scope, the open direction questions put to the owner, and an ADR before any code.

**Definition of Done**
- [x] The owner's instruction recorded (date, scope, what is out): this file's header and spec §9
- [x] The current theming audited with counts and computed contrast (spec §3)
- [x] A token map with light/dark values and computed ratios, a colour-blindness check, and a migration plan with guards (spec §4–§7)
- [x] The direction questions put as multiple choice, with a recommendation and trade-offs (spec §0)
- [x] The placeholder cards replaced by a real plan (this file)
- [ ] The owner's answers to P11-Q1…Q4 recorded (date, verbatim). Then P11-01 writes the ADR
- [ ] The research's open questions (03 §7) answered or listed in `TASKS/BACKLOG.md`. **Deferred** to P11-11, which needs them; they do not block the palette

**Abuse cases**
- Starting a P11 card before the owner answers, on the grounds that "the recommended options are obvious"
- Letting Phase 10's public tokens leak into the dashboard (ADR-098 scopes them to `data-surface="public"`)
- Treating the palette go-ahead as a go-ahead for density, sidebar regrouping or role homes

---

### P11-01 — Token layer, contrast pairs, colour guard, ADR

| | |
|---|---|
| **Status** | BLOCKED — awaiting P11-Q1, P11-Q2 (P11-Q3 for `--chart-*`) |
| **Depends on** | P11-00 answers |
| **Spec refs** | spec P11-00 §2, §4, §7.1, §7.3, §8 · docs/UI-UX/08-COLOR-SYSTEM.md · 00-DESIGN-DIRECTION.md · ADR-090 |
| **Spec required** | no — covered by spec P11-00 |

**Why:** 2,643 class uses already go through semantic tokens. Changing the token **values** recolours almost the whole dashboard with one reviewable diff, and the guard stops it regressing from the first day.

**Definition of Done**
- [ ] `globals.css` `:root` / `.dark` carry the values for the owner's answers (spec §4.2, or §4.5 for a non-recommended answer). Token names are unchanged
- [ ] The new tokens (spec §4.3) are added, each with a `--color-*` mapping:
  - `surface-hover`, `surface-selected`, `sidebar`, `border-strong`;
  - `neutral`;
  - `status-*` aliases;
  - `chart-1…5` (if Q3-A);
  - `scrim`;
  - `primary-hover` / `primary-pressed`
- [ ] `lib/brandColor.ts` `THEME_SURFACES` updated in the same commit. `brandColor.test.ts`, `brandColor.adr090.test.tsx`, `TenantBrandingProvider.test.tsx` and `BrandIcon.p1017` (dashboard-card pairs) follow, **with their assertions unchanged in kind**
- [ ] `a11y.adr090.test.tsx` gains the pairs in spec §7.3 item 5. Each pair is named in the record
- [ ] `src/tests/guards/dashboardColours.p1101.guard.test.ts` is added as a ratchet:
  - its baseline is today's per-file counts (spec §3.3);
  - the allow-list lives in `constants/colourExemptions.ts`, with one reason per entry;
  - a fixture proves that every forbidden form fails
- [ ] The Phase 11 ADR is written (spec §8), and doc 08 (brand, public, tokens, status-tone grammar) and doc 00 ("Theme") are amended with references to it
- [ ] Gates: frontend `npm run typecheck` 0, `npx eslint` on changed files 0, full jest with coverage at the gate, `next build`, bundle budget unchanged

**Abuse cases**
- Lowering a contrast threshold, or removing a pair, to make a value pass
- Seeding the guard's baseline above today's counts "to leave room"
- Using `--pub-*` tokens in the dashboard
- Editing `brandColor.test.ts`'s expectations instead of `THEME_SURFACES`

---

### P11-02 — One theme mechanism; toggle parity on both surfaces

| | |
|---|---|
| **Status** | BLOCKED — awaiting P11-Q4 |
| **Depends on** | P11-00 answers (independent of P11-01) |
| **Spec refs** | spec P11-00 §3.4, §3.5 (D9–D11), §6 · ADR-118 Am. 3 §1–2 · ADR-098 Am. 2 |
| **Spec required** | no — covered by spec P11-00 |

**Why:** the owner asked for a light/dark button on both surfaces. Both buttons exist, but they disagree:
- **D9:** the dashboard's write path skips `data-theme-choice`;
- **D10:** the defaults differ;
- **D11:** the dashboard button is 32 px, English-only, and has no `aria-pressed`.

**Definition of Done**
- [ ] `ThemeContext` writes through the same `applyTheme` that `PublicThemeToggle` uses, and listens to its event (D9)
- [ ] The no-choice default follows P11-Q4 in `ThemeContext`, the init script and `public-surface.css` (D10), with no flash of the wrong theme on a production build
- [ ] The dashboard `ThemeToggle`:
  - is 40 × 40 px with `aria-pressed`;
  - has no status colour on its glyph;
  - stays in `TopBar` beside the notification bell, at every width (D11)
- [ ] A way back to "use the device setting" (only if Q4-A)
- [ ] Tests, named in the record:
  - jest: the write path and both directions of carry-over;
  - browser: landing → dashboard, dashboard → landing by client navigation, no choice + dark system preference
- [ ] The public toggle's tests (`PublicThemeToggle.p1017`) are unchanged and passing
- [ ] Gates as P11-01. On `/login` and `/request-access` the bundle budget may not rise

**Abuse cases**
- Mounting `ThemeProvider` on the public pages to share state (ADR-098 Am. 2 forbids client providers there)
- A second storage key or a cookie
- Hiding the toggle on mobile to save top-bar space

---

### P11-03 — Shell and primitives recolour

| | |
|---|---|
| **Status** | BLOCKED — depends on P11-01 |
| **Depends on** | P11-01 |
| **Spec refs** | spec P11-00 §3.3, §3.5 (D3, D7, D8), §7.1, §7.2 item 1 |
| **Spec required** | no |

**Why:** the shell and `components/ui` appear on all 60 dashboard pages. Their few hard-coded colours (scrims, the impersonation banner, the dropdown panel) are seen everywhere.

**Definition of Done**
- [ ] `Sidebar` uses `--sidebar` and `--surface-selected` for the active item. `TopBar`, `DashboardLayout`, `ImpersonationBanner` (6 palette classes, one `dark:`), `NotificationBell` (D7) and `UserDropdown` use tokens only
- [ ] `Dialog`, `SearchableDropdown` (D3), `ToastContainer`, `Button` (primary hover/pressed tokens), `Avatar` and `AccessDeniedModal` use tokens only. Every scrim is `bg-scrim`
- [ ] The guard baseline is lowered to zero for these files
- [ ] Before/after screenshots, light and dark: the shell open and closed (mobile), a dialog, a dropdown, a toast
- [ ] Gates as P11-01

**Abuse cases**
- Restyling the shell's structure (rail, breadcrumb, user menu) here. That is P11-10

---

### P11-04 — Module sweep, the accent review, D1/D2/D6

| | |
|---|---|
| **Status** | BLOCKED — depends on P11-03 |
| **Depends on** | P11-03 |
| **Spec refs** | spec P11-00 §3.3, §4.3 (`accent`), §7.1, §7.2 items 2–6, §7.3 |
| **Spec required** | no |

**Why:** after P11-01 the remaining raw colours are few (17 hex, 12 palette classes, 48 white/black utilities, 6 `dark:`), but some are real defects:
- **D1:** the backup form is unreadable in dark mode;
- **D2:** the SSO heading is invisible in light mode;
- **D6:** label chips are at 2.56:1.

**Definition of Done**
- [ ] The five batches of spec §7.2 are done, one commit each, with before/after screenshots in both themes (main list, one modal, one form)
- [ ] Each of the 36 `accent` uses is decided:
  - "verified/signed/certificate" keeps `accent`;
  - every other use moves to primary, a chart token or neutral;
  - the list goes in the record
- [ ] D1, D2 and D6 are fixed. User-data colours (kanban project/label colours, the tenant brand picker) stay data, on the allow-list, and their on-colour text is chosen by contrast, not fixed `text-white`
- [ ] The guard is at **zero** outside the reviewed allow-list
- [ ] Gates as P11-01

**Abuse cases**
- Growing the allow-list to pass the guard
- Restyling gradients, hover lifts or layout under cover of "colour". They belong to the home and motion work

---

### P11-05 — Status-tone registry

| | |
|---|---|
| **Status** | BLOCKED — depends on P11-01 |
| **Depends on** | P11-01 (the `--status-*` and `--neutral` tokens) |
| **Spec refs** | spec P11-00 §4.4, §5 · docs/UI-UX/08-COLOR-SYSTEM.md · research 01 §5.3, §7.3 |
| **Spec required** | no — covered by spec P11-00 |

**Why:** 30 files carry their own status→colour map, and `warning` means six things. With a warm accent, simulated colour blindness puts current~draft at ΔE 7 and copper~attention at 7. Shape and icon must carry status, uniformly.

**Definition of Done**
- [ ] `lib/statusTone.ts`: each domain state (device, certificate, calibration due, work order, transfer, opname, ticket, NC/risk, job, invoice, tenant, user, API key, webhook delivery…) maps to one of five tones, with a label, an icon and a shape (spec §5)
- [ ] `Badge` gains a `tone` API rendering that grammar. All 30 local maps call the registry
- [ ] Overdue/non-conformant/failed/revoked are the only alarm tone. Kanban priority is not a status
- [ ] A test asserts the registry against a hand-written table of doc 08's semantics. It is not generated from the registry itself (CLAUDE.md Evidence)
- [ ] Gates as P11-01

**Abuse cases**
- A sixth tone added without a design decision (doc 08 "Adding a Colour")
- Copper, or the tenant brand, inside a badge

---

### P11-06 — Charts

| | |
|---|---|
| **Status** | BLOCKED — depends on P11-01, P11-Q3 |
| **Depends on** | P11-01 |
| **Spec refs** | spec P11-00 §3.1, §3.5 (D5), §4.3 (`--chart-*`), §4.4 · docs/UI-UX/08-COLOR-SYSTEM.md "Charts" |
| **Spec required** | no |

**Why:** the six hand-built charts colour by `var(--primary)`, `var(--accent)` or literal hex. Three kanban priority colours fail 3:1 (D5).

**Definition of Done**
- [ ] `sparkline-chart`, `DashboardCharts`, the kanban dashboard, stock `ReportsTab`, metered billing and batch jobs use `--chart-n` for categorical series and `--status-*` for status series
- [ ] Kanban priority is a sequential ramp with labels
- [ ] Direct labels; at most 5 colour series; series 4–5 carry a marker or pattern (doc 08)
- [ ] Each series colour is ≥ 3:1 on card and page in both themes (pinned by the P11-01 test pairs)
- [ ] Gates as P11-01

**Abuse cases**
- A chart library added to get palettes "for free" (bundle budget; no current chart needs one)

---

### P11-07 — Verification and record (palette and theme)

| | |
|---|---|
| **Status** | BLOCKED — depends on P11-02 … P11-06 |
| **Depends on** | P11-02, P11-03, P11-04, P11-05, P11-06 |
| **Spec refs** | spec P11-00 §7.4 · docs/UI-UX/17-ACCESSIBILITY.md · docs/UI-UX/18-UX-ACCEPTANCE-CRITERIA.md |
| **Spec required** | no |

**Why:** "renders" is not "works". The defects D1–D3 hid in modal and dropdown states that the browser sweep never opens.

**Definition of Done**
- [ ] `automate/a11y.browser.js`, light **and** dark, on a production build, passes with 0 violations over the dashboard routes, **plus** new cases that open the D1–D3 modal and dropdown states
- [ ] The landing ↔ dashboard theme continuity in a browser (P11-02)
- [ ] Before/after screenshots in `docs/UI-UX/research/screens/p11-*`
- [ ] All frontend gates on the final tree; the smoke suite on the disposable stack
- [ ] `MEMORY/records/` entry, `MEMORY-INDEX`, `CHANGELOG` and `TASKS/PROGRESS.md`, in the same commit

**Abuse cases**
- Quoting a pass count from a run on a contended host, or without naming the suite

---

### P11-08 … P11-14 — The larger redesign (needs owner input)

These keep the research's shape and carry no DoD on purpose: a DoD written before the owner's scope would be invented. Each needs its own owner instruction:

| Card | Title |
|---|---|
| P11-08 | Language |
| P11-09 | Density |
| P11-10 | Shell structure |
| P11-11 | Role homes |
| P11-12 | List/object/form patterns |
| P11-13 | Typography |
| P11-14 | Their verification |

The inputs are research 01 §7.3, research 02 §6 and research 03 §5–§7.

**Abuse cases**
- Starting any of them because P11-01 … P11-07 "touch the same files"
