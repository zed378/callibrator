# 2026-10-06 — P11-01 … P11-07: the dashboard follows the warm palette; one light/dark mechanism; status tones

**Cards:** P11-01, P11-02, P11-03, P11-04, P11-05, P11-06, P11-07 (Phase 11, palette and theme scope only)
**Decision:** [ADR-122](../DECISIONS.md) (written first, with an "As built" section at the end)
**Spec:** [`MEMORY/specs/P11-00-dashboard-palette-theme.md`](../specs/P11-00-dashboard-palette-theme.md)
**Owner answers (2026-10-06):** Q1 warm neutral · Q2 copper primary · Q3 warm colour-blind-checked chart set · Q4 follow the device until the user chooses
**Tree:** `main` @ `4584df3` + this work (uncommitted; the coordinator commits). Another agent's backend and lockfile edits were in the working tree at the same time; none of them is part of this record, and the browser stack was built from `HEAD` + this work's `frontend/src` only.

Scope kept: palette and theme only. No layout, density, sidebar structure, navigation, copy or behaviour changed, except the two additions the cards require (the "Use device setting" control; status badges gaining an icon) and two keyboard-access fixes the new 360 px sweep found (§7).

---

## 1. P11-01 — token layer, contrast pairs, colour guard, ADR

- **ADR-122** written before any code; docs amended referencing it: `docs/UI-UX/00-DESIGN-DIRECTION.md` "Theme" (no longer "public surfaces dark only"), `08-COLOR-SYSTEM.md` (brand section → charcoal/copper; public section → ADR-118 warm light + dark; new "The Dashboard Palette", "Status Tones", "Light, Dark and the Device"; chart rules), `06-DESIGN-SYSTEM.md` "Status Presentation", `10-COMPONENT-SPECIFICATION.md` "StatusBadge", `17-ACCESSIBILITY.md` (control boundaries, status shape).
- **`frontend/src/app/globals.css`** `:root` / `.dark`: the spec §4.2 values (token names unchanged), plus the additive tokens with `--color-*` mappings: `border-strong`, `primary-hover`, `primary-pressed`, `surface-hover`, `surface-selected`, `sidebar`, `neutral(-foreground)`, `status-{current,attention,alarm,draft,info}(-foreground)` aliases, `chart-1…5`, `scrim`, and (as built) `scrim-foreground`, `priority-{urgent,high,medium,low,none}`. Tenant-brand rules also swap `--primary-hover/pressed`.
- **`lib/brandColor.ts`**: `THEME_SURFACES` = the warm page/card/muted; `brandForTheme` also derives `hover`/`pressed`; `TenantBrandingProvider` sets `--brand-primary-{hover,pressed}-{light,dark}`. `brandColor.test.ts`'s drift check passed against the new CSS without editing its expectations.
- **Contrast pairs** added to `src/components/ui/a11y.adr090.test.tsx` (it reads `globals.css`; the token regex now accepts digits for `chart-n`): `neutral` joins the status rule; muted-foreground on hover/selected/sidebar; new describe "ADR-122: warm palette pairs" — control boundaries `input`/`border-strong` ≥ 3 on page/card/muted/popover (D4, fail-before 1.23/1.41); focus ring ≥ 3 on page/card/muted/popover/selected/sidebar; primary as text ≥ 4.5 on selected/hover/sidebar; text tokens ≥ 4.5 on hover/selected/sidebar/popover/secondary/muted; primary/hover/pressed fills carry their text ≥ 4.5; chart-1…5 ≥ 3 on card and page and distinct; status aliases point at the right tokens; draft (transparent) badge ≥ 4.5 on every surface; priority ramp ≥ 3 on card/page/muted and monotone (D5); scrim ink ≥ 3 over a white photo. Measured values are spec §4.2's (recomputed: copper text min 4.58 light, 5.66 dark; input 3.24–3.69 light, 3.16–3.84 dark).
- `BrandIcon.p1017.test.tsx` dashboard-card pairs moved to the warm card (`#FFFDF9` / `#23201C`) and gained the sidebar pairs.
- **Guard** `src/tests/guards/dashboardColours.p1101.guard.test.ts` + allow-list `src/constants/colourExemptions.ts` + fixture `src/tests/guards/fixtures/forbiddenColours.fixture.txt` (36 lines: 28 forbidden samples covering all 7 patterns, 8 allowed forms). Patterns: hex, `rgb/hsl/oklch(`, Tailwind palette classes, `white`/`black` utilities, arbitrary colour values, `dark:` colour variants, faded `text-*foreground/NN`.

### Guard numbers (hard-coded colour)

| | Findings | Outside the allow-list | Files |
|---|---|---|---|
| Before (HEAD, seeded as the ratchet) | 94 (18 hex, 13 palette, 48 white/black, 3 `dark:`, 12 faded) | **80** | 40 |
| After P11-03 (shell + `components/ui`) | — | 59 | 30 |
| After P11-04 / P11-06 | 17, all allow-listed | **0** | 0 (`BASELINE = {}`) |

The allow-list (17 findings in 10 entries, each with a reason): kanban project/label colour defaults and fallbacks (user data; the kanban fallback now appears twice per tile because it is also passed to `readableOn`), the tenant brand picker default, the MFA QR's `bg-white` quiet zone, and `#1234` in a placeholder ("matter #1234", not a colour).

## 2. P11-02 — one theme mechanism; toggle parity (D9, D10, D11)

- **`src/lib/theme.ts`** (new, no React): `applyTheme` (`.dark` + `data-theme-choice` + storage + event), `clearThemeChoice`, `syncThemeFromStorage`, `subscribeTheme` (own writes, `storage` from other tabs, device changes). `PublicThemeToggle` uses it and re-exports its old names; `ThemeContext` uses it through `useSyncExternalStore` (`theme`, `systemTheme`, `choice`, `toggleTheme`, `followDevice`).
- **`src/lib/themeInitScript.ts`** (new; imported only by the server layout): with no choice it sets `.dark` from `prefers-color-scheme` (D10) and follows a device change while nothing is chosen; storage read guarded separately.
- **`ThemeToggle`**: 40 × 40 px, `aria-pressed`, name "Dark mode" (English: the dashboard has no ID/EN yet — P11-08), glyph in neutral ink (no `text-warning`). Same place in `TopBar`, every width.
- **"Use device setting"**: an "Appearance" card on `/dashboard/profile` (`profile/components/AppearanceSettings.tsx`). The dashboard has no user menu (`UserDropdown` is not rendered anywhere), so spec §6 item 2's fallback applies; the menu itself is P11-10.
- Public toggle tests `PublicThemeToggle.p1017.test.tsx` unchanged and passing. `/login` and `/request-access` budgets did not exceed their ceilings (§8).

## 3. P11-03 — shell and `components/ui`

`Sidebar` (`bg-sidebar`, active item `bg-surface-selected text-primary`, hover `surface-hover`, chevrons full `muted-foreground` — were `/60` at 2.88:1, scrim), `ImpersonationBanner` (D8: `bg-warning/10 text-warning`, button on card), `NotificationBell` (D7: timestamp and read titles no longer faded), `UserDropdown`, `Dialog` and `AccessDeniedModal` (`bg-scrim`), `SearchableDropdown` (D3: `bg-popover text-popover-foreground`), `ToastContainer`, `Button` (`hover:bg-primary-hover active:bg-primary-pressed`), `Avatar` (no accent, `text-primary-foreground`), `Table` spinner (`border-t-primary`). Guard baseline for these files: zero.

## 4. P11-04 — module sweep, accent review, D1/D2/D6

- **Batch 1 equipment/calibration:** `RecordCalibrationModal` radios `accent-success` / `accent-destructive`.
- **Batch 2 warehouse/stock/vendors:** `VendorsTable` approve/reject icons `text-success` / `text-warning`.
- **Batch 3 organisation:** D1 `BackupCreateModal` inputs `bg-card border-input focus:ring-ring`; D2 `SsoSettingsPanel` heading `text-foreground`; SSO switch track `bg-border-strong`, knob `bg-card`; every modal scrim `bg-scrim` (Roles ×2, Session confirm, Tenants ×3, Backup, Users ×2); `SessionRow` dot `border-card` and two broken classes (`text-foreground0/20`, `bg-muted0/10`) removed; user avatar overlay `bg-scrim`, chip `bg-card`.
- **Batch 4 work:** kanban tiles and label chips draw their text with `lib/readableOn.ts` (D6: was `text-white`, 2.56:1 on the default label grey); attachment remove `bg-scrim text-scrim-foreground`; card modal scrim.
- **Batch 5 the rest:** content cover-image remove, profile avatar overlay (`text-scrim-foreground`), empty-state icons full `muted-foreground` + `aria-hidden` (access requests, permissions, user permissions, home charts), home components (`health-indicator`, `quick-action`, `activity-timeline-item` — its initials were `text-white` on a `/20` copper tint, a defect beyond D1–D11 — and `stat-card`'s `via-white` sheen). The MFA QR keeps `bg-white` (allow-listed).
- **Accent review (36 uses in 10 files at HEAD; 4 more outside the dashboard tree):**

| Where | Was | Now |
|---|---|---|
| Home stats: Certificates | `primary` | **`accent`** (the one "certificate/verified" use kept) |
| Home stats: Tenants, Devices | `accent`, `info` | `chart-2` |
| Home stats: Warehouses | `accent` | `chart-4` |
| Home stats: Low stock, Due in 30 days | `accent`, `info` | `warning` (attention) |
| Home stats: Open work orders / Pending transfers | `success` | `chart-3` (not a status) |
| Home stats: Users/Team members/Certificates border blends | `from-primary to-accent` | one colour per tile |
| `stat-card` top gradient | copper→teal | literal per-colour map |
| Quick action "Tenants", `TenantBreakdown` icon | `accent` | `chart-2` |
| Menu groups `SummaryStats` "purple" | `accent` | `chart-4` |
| Home decorative blob (dark) | `to-accent/10` | `to-primary/5` |
| Storage page icon | `accent` | `primary` |
| `UserRow` and `Avatar` gradients | `from-primary to-accent` | `to-primary-hover` |
| `AuroraBackground` orb | `accent/25` | `chart-2/20` |
| "Certificates Issued" sparkline | `var(--accent)` | `var(--chart-2)` (P11-06) |
| `not-found`, `oauth/consent`, `sso-callback` blends | `to-accent` | **unchanged** — outside the dashboard tree; noted for a later card |

## 5. P11-05 — the status-tone registry

`src/lib/statusTone.ts` (27 domains), `Badge tone` (shape class + lucide icon, `data-tone`), `components/ui/StatusBadge.tsx`. Every local map now calls the registry — 28 files: `DevicesTable`, `CertificatesTable`, `calibration-scheduler`, `WorkOrdersTable`, `TransfersTable`, `OpnamesTable`, `WarehouseTable`, `VendorsTable`, `ApiKeysTable`, `SubscriptionCard`, `InvoicesTable`, `BackupList`, `ticketBadges`, `SessionRow`, `UserRow` + `useUsers`, `TenantCard`, `TenantBreakdown`, `access-requests`, `batch-jobs`, `content`, `custom-domains`, `esignature`, `qms`, `risk`, `supplier-scorecard`, `tenant-lifecycle`, `SprintBar`, `DeliveriesPanel`. Kanban and ticket **priority** became neutral chips with a ramp dot (`lib/priority.ts`), never a status tone. Not converted (not badges): `health-indicator` (a tile with a dot and a word), notification-type icons, permission-level toggles.

Tone changes from the old maps (the judgement calls are in ADR-122 "As built"): device `retired` danger → draft; tenant/user `SUSPENDED` danger → attention; user `PENDING` warning → draft; vendor `Inactive` warning → draft; API key `expired` danger → draft; transfer `cancelled` danger → draft; e-signature `expired`/`cancelled` danger → draft; access request `spam` danger → draft; session expired destructive → draft; content `DRAFT` warning → draft; invoice `Void` danger → draft; tenant lifecycle `OFFBOARDED` danger → draft. Labels are the words each page showed before.

## 6. P11-06 — charts

`DashboardCharts` sparklines: Calibrations `var(--chart-1)`, Certificates `var(--chart-2)` (each under its own title — the direct label). Kanban dashboard "Cards by priority": `var(--priority-*)` ramp (D5; was 1.48–3.76:1), each bar labelled. Kanban label bars stay the user's colours (data). No chart library added. The other spec-listed charts (stock `ReportsTab`, metered billing, batch jobs) already used tokens only; nothing to change there.

## 7. Defects

| # | Fixed in | Test (fail-before) |
|---|---|---|
| D1 backup inputs 1.23:1 dark | P11-04 | `p11Defects.d1-d8.test.ts` "D1 … dark" (HEAD 1.23) + boundary case |
| D2 SSO heading 1.05:1 light | P11-04 | same file "D2 … light" (HEAD 1.05) |
| D3 dropdown panel 1.11:1 dark | P11-03 | same file "D3 … dark" (HEAD 1.11) |
| D4 input boundary 1.23/1.41 | P11-01 | `a11y.adr090` "control boundaries … 3:1" |
| D5 kanban priority 1.48–3.76 | P11-06 | `a11y.adr090` "the priority ramp is 3:1 …" |
| D6 white on label grey 2.56 | P11-04 | `lib/readableOn.test.ts` |
| D7 faded timestamp 3.59/3.56 | P11-03 | `p11Defects` "D7" (HEAD 3.59/3.56) |
| D8 impersonation banner | P11-03 | `p11Defects` "D8" (HEAD: palette class, refused by the resolver) |
| D9 no `data-theme-choice` from the dashboard | P11-02 | `ThemeContext.test.tsx` "D9: toggling marks data-theme-choice…"; browser continuity c |
| D10 light dashboard on a dark device | P11-02 | `ThemeContext.test.tsx` "D10…", `themeInitScript.test.ts`; browser continuity a |
| D11 32 px, no `aria-pressed` | P11-02 | `TopBar.test.tsx` "the theme switch toggles dark mode, reports it pressed…" |
| + home "Users" initials white on `/20` copper | P11-04 | (class fix; guard) |
| + `SessionRow` non-existent classes | P11-05 | registry badge |
| + `TenantBreakdown` scroll region not keyboard-reachable at 360 px (super admin home) | P11-07 | `TenantBreakdown.p1107.test.tsx` |
| + `Table` scroll wrapper not keyboard-reachable at 360 px (`/dashboard/calibration`) | P11-07 | `a11y.adr090` "its sideways-scrolling wrapper is keyboard-reachable…" |

The fail-before numbers for D1–D3/D7/D8 come from running the test's own extraction and resolver over `git show HEAD:` of each file and `globals.css`.

## 8. Gates

Filled in §10 after the final run (the coordinator warned that another agent's `npm ci`/`npm install` emptied and restored `node_modules` during this work; every gate below was re-run after that).

## 9. Browser verification

**Stacks** (disposable, production mode, `deploy/compose/docker-compose.yml` + `docker-compose.e2e.yml`, env from `scripts/ci/e2e-env.sh`, signed in as the seeded operator `sys@mail.com` with the stack's bootstrap password from `/app/.bootstrap/superadmin-password` and a random password set through the harness; TOTP from the harness's state file):
- **`p11before`** (ports 27180–27182), built from `git archive HEAD`: the "before" screenshots only. Removed by name (`down -v --remove-orphans`, images `p11before/*`).
- **`p11after`** (ports 27185–27187), built from `HEAD` + this work's `frontend/src` (+ `automate/p11.browser.mts`); the frontend image was rebuilt twice in place for the two §7 keyboard fixes.

**New suite `automate/p11.browser.mts`** (checked by `automate/tsconfig.json`): continuity a–d (no choice + dark device → landing and dashboard dark, dark at the first frame, nothing stored; dark chosen on the landing → dashboard dark and toggle pressed; light chosen in the dashboard on a dark device → a public surface in the same document is ivory, and `/` after navigating; "Use device setting" clears and follows a live device change), states (D1 backup dialog, D2 SSO panel, D7 notification panel, add-device dialog; axe in both themes), axe over 9 dashboard pages × light/dark × 360/768/1280/1536, and WebP screenshots.

Results — see §10.

**Screenshots:** `docs/UI-UX/research/screens/p11-before-*` and `p11-after-*` (60 WebP, 1.8 MB): home, devices (status badge set), calibration, maintenance, users, vendors, tenants, kanban, profile at 1280, the shell at 360 closed and open, the backup and add-device dialogs, the SSO panel and the notification panel — light and dark each.

## 10. Results

### Frontend gates (final tree, re-run after the shared `node_modules` was restored; host quiet)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (TypeScript 7) | 0 errors |
| Browser specs | `node node_modules/@typescript/native/bin/tsc -p automate/tsconfig.json` | exit 0 |
| Lint | `npx eslint` on every changed/new file | **0 errors**, 13 warnings — all pre-existing (unused vars in `profile/page.tsx`, `ProfileForm`, `RolesModal`, `CreateTenantModal`, `EditModal`, `TenantCard`, `WarehouseTable`, test files); every warning this work introduced was removed |
| Jest + coverage | `npx jest --coverage --ci` | **305 suites, 3,307 tests, 0 failed**; 94.02 / 84.92 / 89.62 / 94.68 (gate 90/81/86/91; was 93.94/84.77/89.63/94.6) |
| Build | `node ../node_modules/next/dist/bin/next build` | exit 0, 84 pages. (`npx next build` resolved to a broken bun shim in this workspace after the other agent's reinstall; the direct binary is the same Next.) |
| Bundle budget | `node scripts/bundle-budget.mjs` | **10/10 within, no ceiling raised.** `/` brotli 128.4/180, **gzip 149.4/150** (was 148.7; +0.7 KB, the shared `lib/theme.ts`); `/login` 154.2/155; `/request-access` 147.7/148; `/verify` 118.4/120. Margins are now thin on `/` gzip and `/request-access` |

### New and changed tests (named)

`src/tests/guards/dashboardColours.p1101.guard.test.ts` (guard + 36-sample fixture) · `src/tests/guards/p11Defects.d1-d8.test.ts` · `src/components/ui/a11y.adr090.test.tsx` (ADR-122 pairs, Table scroll case) · `src/lib/brandColor.test.ts` (hover/pressed) · `src/components/brand/__tests__/BrandIcon.p1017.test.tsx` (warm card + sidebar) · `src/contexts/__tests__/ThemeContext.test.tsx` (rewritten: D9, D10, carry-over both ways, other tab, device change, follow device, blocked storage) · `src/lib/themeInitScript.test.ts` · `src/components/layouts/__tests__/TopBar.test.tsx` (D11) · `src/app/dashboard/profile/components/__tests__/AppearanceSettings.p1102.test.tsx` · `src/lib/statusTone.test.ts` (hand-written doc 08 table; alarm allow-set) · `src/components/ui/__tests__/StatusBadge.p1105.test.tsx` · `src/lib/readableOn.test.ts` · `src/app/dashboard/components/__tests__/TenantBreakdown.p1107.test.tsx`. Assertions changed by decision (each says why in the file): `TopBar` (toggle name/pressed), `useUsers.test.ts` (tones), tenants page, custom-domains page and backup `a362` tests (`data-tone` instead of colour class; suspended is attention). `PublicThemeToggle.p1017.test.tsx` unchanged and green.

### Browser runs on `p11after` (production build)

| Run | Suite | Result |
|---|---|---|
| 1 (09:58–10:31 +07) | `p11.browser.mts` continuity + states + shots | **33/33** |
| | `p11.browser.mts` axe (72) | 70/72 — `scrollable-region-focusable` on `/dashboard` at 360 (super admin's `TenantBreakdown`), both themes → fixed (§7) |
| | `a11y.browser.js` | **80/80** |
| | `p10.browser.mts` | 4/12 — **invalid run**: I ran the typecheck and eslint on the same host during it (first failure a 30 s timeout on `/request-access`, the rest cascaded). Re-run alone straight after: **12/12** (SSO skipped by name, as in every run) |
| | `smoke.browser.js` | **7/7** |
| 2 (after the TenantBreakdown fix) | `p11` continuity + states + axe | 83/85 — the same finding on `/dashboard/calibration` at 360 (the shared `Table` wrapper) → fixed (§7) |
| **3 — final image, quiet host (10:41–11:05)** | `p11.browser.mts` continuity a–d + states (8) + axe 9 pages × 2 themes × 4 widths (72) | **85/85** |
| | `a11y.browser.js` (light + dark: axe, dialogs, reflow, motion, brand) | **80/80** |
| | `p10.browser.mts` | **12/12** (SSO skipped by name) |
| | `smoke.browser.js` | **7/7** |
| | `responsive.browser.js` | **45/45** page-mode pairs clean |

The public dark mode is proved by continuity a (landing `rgb(26,21,17)` = `#1A1511` with no choice on a dark device), continuity c (ivory `#FBF7F0` after choosing light in the dashboard), P10 12/12 and a11y 80/80 (public pages in both themes).

**Cleanup:** projects `p11before` and `p11after` removed with `down -v --remove-orphans`; images `p11before/backend:e2e`, `p11before/frontend:e2e`, `p11after/backend:e2e`, `p11after/frontend:e2e` removed by name. Afterwards 0 containers, volumes, images or networks match `p11`. Nothing pruned; the VM was not touched. The scratchpad env files (random secrets of the destroyed stacks) were left in the session's private scratchpad.

## 11. Left open

- **Owner-gated cards P11-08 … P11-14** untouched (language, density, shell structure incl. a real user menu, role homes, patterns, typography).
- ~~`app/not-found.tsx`, `app/oauth/consent`, `app/sso-callback` keep a `from-primary to-accent` blend (outside the dashboard guard's tree).~~ **Closed 2026-10-07, § 12.1.**
- ~~Status-like UI that is not a badge (`health-indicator`, notification-type icons) still colours by token without the tone grammar; inline `variant={x ? "success" : "default"}` chips outside the 28 converted maps were not swept.~~ **Closed 2026-10-07 for the health tile, the verdict and every inline chip, § 12.2;** notification-type icons stay as they are (§ 12.4).
- `SearchableDropdown` and `UserDropdown` are dead components (fixed anyway).
- Bundle headroom: `/` gzip 149.4 of 150.
- Live E2E (`make test-e2e`) was not run: the work is frontend-only and the smoke 7/7 is the spec's bar (§7.4).

## 12. Addendum (2026-10-07) — the two items left open

**Decision:** ADR-122 **Amendment 1** (`MEMORY/DECISIONS.md`, at the end of ADR-122). **Tree:** `main` @ `755314d` + this work, frontend only (uncommitted; the coordinator commits). Other agents worked in `docs/`, `TASKS/`, `MEMORY/` and possibly the landing at the same time; none of their files is part of this addendum.

### 12.1 The public error and auth pages on the tokens; the guard covers `app/**` and `components/**`

- **`app/not-found.tsx`:** the "0" of 404 is `text-primary` (was a `from-primary to-accent` clipped gradient); "Back to home" is `bg-primary hover:bg-primary-hover active:bg-primary-pressed` (was the copper→teal blend); the footnote is full `text-muted-foreground` (was `/70`, contrast unverified). The stale comment ("trust-blue / health-green") is rewritten.
- **`app/oauth/consent/page.tsx`:** "Allow" is `bg-primary` + hover/pressed (was the blend).
- **`app/sso-callback/page.tsx`:** page and fallback background `bg-background` (was `from-muted via-info/10 to-primary/10`); "Back to Login" `bg-primary` + hover/pressed; the card gained `border-border` (it sat on a tinted page before). Its `AnimatedBackground` used `orb`, `orb-primary`, `orb-accent`, `orb-secondary` and `bg-grid-pattern` — **classes defined nowhere** (not in `globals.css`, not Tailwind), so it drew nothing; removed. (`app/dashboard/components/grid-background.tsx` uses the same dead classes; untouched, noted.)
- **`components/brand/BrandIcon.tsx`:** the four brand hex values were in a doc comment; the comment now points at the `--logo-ink` / `--logo-accent` tokens and doc 08 "Brand" instead.
- **`components/auth/BrandMark.tsx`** (rendered nowhere today): `ring-black/5` → `ring-border`; the tenant logo's `bg-white` plate is **allow-listed** (a logo image drawn for a light ground vanishes on the dark card).
- **Guard** `src/tests/guards/dashboardColours.p1101.guard.test.ts`: `ROOTS = ["app", "components"]` (was 7 dashboard roots + 3 single files; the singles are still asserted to be scanned). The public surface is **included**, not excluded — `app/page.tsx`, `components/public/**` and the other public pages had 0 findings when the scope grew; `public-surface.css` is CSS and not scanned. New kind **`blend`**: on a line naming `bg-linear|radial|conic|gradient`, the `from-/via-/to-` stops are reduced to hues (`-hover`/`-pressed` stripped; `transparent`, `background`, `card`, `muted`, `popover`, `foreground`, `border`, `sidebar`, `secondary`, `current`, `inherit` count as neutral); two or more hues is a finding. Every dashboard gradient is one hue (`from-chart-2 to-chart-2`, `from-primary to-primary-hover`, fades into `background`), so none fired there. Fixture +7 lines (3 blends, 4 allowed gradients).

| Guard `dashboardColours.p1101` | Scope | Findings outside the allow-list | Allow-list |
|---|---|---|---|
| Before (scope grown, pages unchanged — the fail-before run) | `app/**` + `components/**` | **15 in 5 files**: not-found (1 faded, 2 blend), oauth/consent (1 blend), sso-callback (3 blend), BrandIcon (4 hex), BrandMark (`bg-white`, `ring-black`) | 17 findings, 10 entries |
| After | same | **0** | **18 findings, 11 entries** (+ BrandMark `bg-white`) |

### 12.2 Status chips on the registry; a guard

**Found by grep** (`<Badge … variant=` naming success/warning/danger), plus the computed variants the typecheck found once `Badge` lost those three: 40 inline chips in 25 files, 10 computed ones in 8 files, the backup-type colour map, the kanban WIP pill, and the health tile and verdict.

- **`lib/statusTone.ts` +25 domains** (labels = the words each page showed): `calibrationResult`, `active`, `enabled`, `webhook`, `legalHold`, `iotIngest`, `consent`, `mfa`, `recoveryCodes`, `passkey`, `restriction`, `setting`, `accessDecision`, `stockLevel`, `sop`, `approval`, `vendorApproval`, `restoreGap`, `menuAssignment`, `duplicate`, `wip`, `health`, `healthVerdict`, `intervalAdvice`, `auditEvent`. Tone choices: ADR-122 Am. 1 §4.
- **Converted to `StatusBadge`:** calibration records (Compliant / Non-Compliant), data-retention legal hold, IoT ingest, e-signature "awaiting your signature" (`esignature` `pending`), feature flags, GDPR consent, menu-group assignment (card + `AssignmentBadge`; the hand-placed icons replaced by the tone icon), metered-billing invoices (the `invoice` domain, case-insensitive), MFA enabled + recovery codes, network security (allow-list, geofence, evaluation, step-up), reports (low stock, overdue days), roles active, SCIM active, SOP status, tenant hierarchy (`tenantLifecycle`), restore-outcome reasons, vendor approval, storage locations (`warehouse`), passkeys, webhooks, workflows (active + instance status), access-request duplicates, the kanban over-WIP count, predictive-maintenance interval advice, audit security events.
- **System health:** `health-indicator.tsx` is a neutral card with a `StatusBadge domain="health"` (was a tinted tile with a pulsing colour dot and a coloured word); the panel's verdict is `StatusBadge domain="healthVerdict"` inside the same `data-testid` / `data-status` wrapper.
- **Not statuses → neutral:** new `components/ui/PriorityChip.tsx` (the P11-06 ramp dot on a `bg-muted` chip, `data-level`) for work-order priority, QMS severity, risk RPN (≥ 15 urgent, ≥ 8 medium, else low) and the supplier score band (< 60 urgent, < 80 medium, else low); `variant="secondary"` for role level, audit verbs (`CREATE` … `EXPORT`), stock-adjustment type and backup type (was info/warning/success); plan tier `primary` (enterprise was `success`).
- **`Badge`:** `variant` is now `default | primary | secondary | info`; `success` / `warning` / `danger` and their classes removed.
- **Guard** `src/tests/guards/statusChips.p1105.guard.test.ts` (new): scans `app/**` + `components/**` (not `Badge.tsx` / `StatusBadge.tsx`) for a `<Badge>` whose `variant` names success/warning/danger, a literal `tone=`, and a hand-made pill (`rounded-full` + `px-` + a status tint and text in one `className`). No allow-list. Fixture: 7 forbidden samples, 8 allowed (Button/Alert variants, `tone={toneOf(…)}`, an icon circle, a neutral pill).

| Guard `statusChips.p1105` | Findings |
|---|---|
| Before (the fail-before run on the unchanged pages) | **40 in 25 files** (39 `variant`, 1 `pill`); the 10 computed variants were caught by the typecheck once the type lost the three variants |
| After | **0** |

**Docs amended (referencing ADR-122 Am. 1):** `docs/UI-UX/08-COLOR-SYSTEM.md` (the guard scope and the `blend` form), `docs/UI-UX/10-COMPONENT-SPECIFICATION.md` "StatusBadge" (no colour-only status chip; ordinal level = `PriorityChip`; category = neutral `Badge`).

### 12.3 Tests (named; fail-before where the behaviour changed)

- `src/tests/guards/dashboardColours.p1101.guard.test.ts` — fail-before 15 findings (§ 12.1); 46/46 after.
- `src/tests/guards/statusChips.p1105.guard.test.ts` — new; fail-before 40 findings; 17/17 after.
- `src/app/dashboard/components/DashboardSystemHealth.test.tsx` "ADR-122 Am. 1: each probe and the verdict carry a status tone…" — new; failed before (no `[data-tone]`, received `null`), passes after.
- `src/lib/statusTone.test.ts` — 38 hand-written rows for the new domains, and 5 alarm states added to the allow-set (written from doc 08, not generated from the registry).
- `src/components/ui/__tests__/PriorityChip.p1105.test.tsx` — new (ramp dot per level, never a status colour, axe-clean beside the converted badges and the health tile).
- `src/components/ui/Badge.test.tsx` — the three colour-variant cases now assert the type refuses them (`@ts-expect-error`, so the typecheck fails if the variants come back).
- **Assertions changed by decision** (each comment says why): `metered-billing` (`data-tone` current/info instead of `text-success`/`text-warning`), `predictive-maintenance` (`data-tone` attention/info), `risk` and `supplier-scorecard` (`data-level` urgent/medium/low instead of a status colour class), `tests/components/BoardColumn.test.tsx` (+ the over-limit count is `data-tone="attention"`; on HEAD the pill had no `data-tone`). Each new assertion fails on HEAD's markup, which carries no `data-tone` / `data-level` there.

### 12.4 Gates (this tree)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | 0 errors |
| Lint | `npx eslint` on every changed and new `.ts`/`.tsx` file (56) | **0 errors, 0 warnings** |
| Jest + coverage | `npx jest --coverage --ci` | **307 suites, 3,376 tests, 0 failed**; **94.02 / 84.9 / 89.65 / 94.67** (gate 90/81/86/91; was 94.02/84.92/89.62/94.68). An earlier run on the same tree failed once in `kanban/[projectId]/hooks/useBoard.realtime.test.ts` (a 40 s suite under load, a file this work does not touch); alone 3/3, and the full re-run above is green |
| Build | `node ../node_modules/next/dist/bin/next build` | exit 0 |
| Bundle budget | `node scripts/bundle-budget.mjs` | **10/10 within, no ceiling raised**; `/` gzip **149.4/150** (unchanged), brotli 128.5/180; `/login` brotli 154.2/155 |
| axe, production build | `next start -p 34517` (stopped by PID afterwards), puppeteer-core + axe-core, 4 pages × light/dark (device `prefers-color-scheme`) × 360/1280: `/no-such-page-404`, `/oauth/consent?…`, `/sso-callback?error=access_denied`, `/sso-callback` | **16/16, 0 violations**; the `.dark` class followed the device each time |

**Not verified in a browser:** the converted dashboard pages — their badges are the existing `Badge tone` primitive, whose contrast pairs `a11y.adr090` pins, and `PriorityChip.p1105` runs jsdom axe; no backend stack was started. The consent page rendered its error state (no backend), so the restyled "Allow" button was not in the axe run. Live E2E not run (frontend only).

**Not converted (not statuses of a record):** notification-type icons, permission-level toggles (`permissions`, `user-permissions`), the stat tiles (`session-management` counts, stock `ReportsTab` low-stock tile, menu-group `SummaryStats`), and form success/error message boxes (messages, not chips). `grid-background.tsx`'s dead `orb-*` classes are left as found.
