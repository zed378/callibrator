# 02 — `@callibrator/tokens` (TARGET)

> **Status: TARGET (ADR-134). Not built.** The values it will hold are **as built** today in
> `frontend/src/app/globals.css` (`:root` and `.dark`, ADR-090 names, ADR-122 values),
> `frontend/src/app/public-surface.css` (`--pub-*`, ADR-118), `frontend/src/lib/statusTone.ts`
> (ADR-122 § 6), `frontend/src/lib/priority.ts`, `frontend/src/lib/brandColor.ts` and
> `frontend/src/lib/readableOn.ts`. Built by P35-02.

---

## 1. Purpose

One source of design values — colour, type, space, radius, elevation, motion, breakpoints and the
status tones — consumed as **CSS custom properties** by the web and as a **typed theme object** by
React Native. "Same brand, native feel" (owner, 2026-10-08) means the *values* are shared and the
*rendering* is each platform's own: the app draws native controls in the brand's colours and
semantics; it does not imitate web components.

## 2. The Source of Truth: TypeScript, With a Small Generator

**Decision (ADR-134 § A.6):** tokens are written as **typed TypeScript objects** in
`packages/tokens/src/`, and a ~150-line generator in the package (`scripts/build-css.ts`, run under
the repository's TypeScript tooling) writes **`packages/tokens/generated/tokens.css`**, which
`frontend/src/app/globals.css` imports. React Native imports the objects directly — no generation
step on that side. The generated CSS is **committed** and checked by `npm run tokens:check`
(regenerate and diff), the same pattern as `api:types:check` (ADR-103).

| | TypeScript + own generator (**chosen**) | Style Dictionary 4 (DTCG JSON source) |
|---|---|---|
| Source typing | the source *is* typed; a missing dark value or a misspelt role is a compile error | JSON; types only after a build, and only as good as the format config |
| The ADR-090 contrast rule | the contrast test imports the same objects (`contrast.test.ts`) | the test reads generated output or re-parses JSON |
| Output targets needed | two: CSS variables, and the object RN imports as is | many built in (iOS Swift, Android XML, SCSS …) — none of which this project uses (Expo renders in JS) |
| Dependency and build | none at runtime; one script | a build-time dependency with its own config and transform pipeline |
| Design-tool interchange (Figma variables via DTCG) | not native; an exporter could be added later | native |
| Size of the problem | ~60 colour roles × 2 themes, 5 tones, a type scale, spacing, radius, motion, breakpoints | built for large multi-brand systems |

Style Dictionary's strengths are multi-format native output and design-tool interchange; this
project needs neither today (no native Swift/Kotlin UI, no design-tool sync — `../UI-UX/` specifies
in Markdown). If a Figma-variables workflow is adopted later, a DTCG **exporter** from the TS source
is the reversible path, not a change of source.

## 3. Layout of the Package

```text
packages/tokens/
├── package.json              # "@callibrator/tokens", private, exports ./src/*.ts and ./generated/tokens.css
├── src/
│   ├── index.ts              # named re-exports only
│   ├── color.ts              # semantic roles, light + dark (ADR-090 names; ADR-122 values)
│   ├── status.ts             # the five tones: colours, fill style, shape, icon name (ADR-122 § 6)
│   ├── priority.ts           # the sequential copper ramp for priority dots (never a status tone)
│   ├── chart.ts              # categorical series 1–5
│   ├── typography.ts         # families per platform, scale, weights, line heights, tabular numerals
│   ├── space.ts              # 4-px spacing scale
│   ├── radius.ts             # radii
│   ├── elevation.ts          # web box-shadows / native elevation + shadow pairs
│   ├── motion.ts             # durations and easings; the reduced-motion rule
│   ├── breakpoints.ts        # web breakpoints (px) and native window classes (dp)
│   ├── brand.ts              # tenant brand colour → per-theme primary (from brandColor.ts)
│   └── contrast.ts           # parseHex, relative luminance, contrastRatio, readableOn
├── scripts/build-css.ts      # writes generated/tokens.css
├── generated/tokens.css      # committed; `tokens:check` fails on drift
└── test/                     # 100 % thresholds (90 § 6)
```

## 4. Colour

### 4.1 Roles (as built today, moved byte-for-byte)

The role names are ADR-090's and the values ADR-122's: `background`, `foreground`, `card`,
`card-foreground`, `popover`, `popover-foreground`, `muted`, `muted-foreground`, `border`, `input`,
`border-strong`, `ring`, `primary` (copper, **tenant-overridable**), `primary-foreground`,
`primary-hover`, `primary-pressed`, `secondary`, `secondary-foreground`, `accent` (verified teal),
`accent-foreground`, `success`, `warning`, `destructive`, `info`, `neutral` and their
`-foreground`s, `surface-hover`, `surface-selected`, `sidebar`, `scrim`, `scrim-foreground`,
`status-{current,attention,alarm,draft,info}` and their foregrounds, `chart-1 … 5`,
`priority-{urgent,high,medium,low,none}`.

```ts
// packages/tokens/src/color.ts (shape — the values are copied from globals.css at P35-02)
export const COLOR_ROLES = ["background", "foreground", /* … every role above … */] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];
export type Palette = Readonly<Record<ColorRole, `#${string}`>>;
export const light: Palette = { background: "#faf8f5", foreground: "#1f1b17", /* … */ };
export const dark: Palette = { /* … */ };
```

- **Every value stays a plain `#RRGGBB` literal** (the rule `globals.css` states today, so the
  contrast test can read it). React Native accepts the same strings.
- **Tints are explicit for native.** The web draws a tone's `/10` tint and `/40` border with
  Tailwind's opacity modifier on the variable; React Native has no such modifier. `status.ts`
  therefore also exports each tone's tint and tint-border as `#RRGGBBAA` (computed once by the
  package, tested for the same 4.5:1 text contrast on the tint that ADR-090 requires on the web).
- **The public surface's `--pub-*` variables** stay in `public-surface.css` (the marketing surface
  has no native counterpart), but every `--pub-*` that *equals* a semantic role today
  (`--primary` = `--pub-accent`, `--success` = `--pub-success`, `--destructive` = `--pub-danger`)
  becomes a reference to the generated variable, so the copper exists once.

### 4.2 The generated CSS

```css
/* packages/tokens/generated/tokens.css — GENERATED by scripts/build-css.ts; do not edit */
:root { --background: #faf8f5; --foreground: #1f1b17; /* … every role, light … */ }
.dark { --background: …; /* … every role, dark … */ }
```

`globals.css` keeps its `@theme inline { --color-x: var(--x) }` block and its `@variant dark`
(the Tailwind wiring is web-only) and replaces its literal `:root`/`.dark` colour blocks with
`@import "@callibrator/tokens/generated/tokens.css";`. **Proof of no change** (P35-02 DoD): the
custom properties resolved on `:root` and on `.dark` are compared before and after, property by
property, and `components/ui/a11y.adr090.test.tsx` (which reads `globals.css` today) is pointed at
the package's objects and passes unchanged.

### 4.3 The tenant brand colour

A tenant's brand colour overrides `primary` (as built, ADR-090 amendment of 2026-09-29,
`frontend/src/lib/brandColor.ts`): it is **never applied unchecked** — `brand.ts` derives one
`primary` per theme that meets 4.5:1 there, keeping hue and saturation and moving lightness only.
The function moves to the package unchanged (with `brandColor.test.ts`) so the app applies the same
derivation to the same server value. The web applies it by overriding `--primary` (as today); the
app merges it into the theme object at sign-in (`createTheme(scheme, { brand })`, § 9).

### 4.4 The tenant tonal ramp (owner decision 2026-10-08 — the app's pre-sign-in branding)

The app shows the tenant's brand from the first screen after tenant setup (`../MOBILE/20` § 2a), using
the one `primaryColor` the public lookup returns. `brand.ts` derives from it, per theme, a **tonal
ramp** — no schema change, nothing else stored:

```ts
export interface BrandRamp { 50: Hex; 100: Hex; 200: Hex; 300: Hex; 400: Hex; 500: Hex; 600: Hex; 700: Hex; 800: Hex; 900: Hex;
  primary: Hex; primaryForeground: Hex; primaryHover: Hex; primaryPressed: Hex; source: "tenant" | "fallback" }
export function brandRamp(primaryColor: string | null, scheme: "light" | "dark"): BrandRamp;
```

- Steps keep the brand's hue and saturation and move lightness in OKLCH (perceptually even); the
  scheme's `primary` is the step that meets ADR-090's rule (4.5:1 as text on page and card, its
  foreground 4.5:1 on it, 3:1 as a boundary) — the as-built per-theme derivation, extended to a ramp.
- **WCAG-AA guard with a fallback:** if no step of the tenant's hue can satisfy every pair in a scheme
  (an extreme or unparseable value), the ramp is the **brand copper's** for that scheme
  (`source: "fallback"`), never a near-miss. A test feeds pure yellow, pure blue, near-white, near-black,
  invalid strings and null, and asserts every returned pair passes or the fallback was used.
- **Status tones are never tenant-coloured** (ADR-122 § 6): `brandRamp` feeds `primary*` and brand
  accents only; `TONES` and the `status-*` roles ignore it, and a test asserts `createTheme(scheme,
  { brand })` leaves every tone and status role byte-identical for any brand input.
- The web applies the same function where it shows tenant branding (today `--primary` only); the app
  merges the ramp into its theme (`createTheme(scheme, { brand })`, § 9).

## 5. Status Tones — Shape, Icon, Text, Then Colour

As built (ADR-122 § 6, `statusTone.ts`): **five** tones; each has a fixed shape and icon so status
survives colour blindness and greyscale print; a sixth needs a design decision.

| Tone | Fill | Icon (`@callibrator/icons` name) | Means |
|---|---|---|---|
| `alarm` | solid fill | `status.alarm` → `octagon-alert` | overdue, non-conformant, failed, revoked — **nothing else** |
| `attention` | tint + tint border | `status.attention` → `triangle-alert` | due soon, in progress, pending approval, maintenance |
| `current` | tint | `status.current` → `circle-check` | current, active, completed, valid |
| `draft` | dashed outline | `status.draft` → `circle-dashed` | draft, inactive, pending, cancelled |
| `info` | tint | `status.info` → `info` | informational |

```ts
// packages/tokens/src/status.ts (shape)
export type StatusTone = "alarm" | "attention" | "current" | "draft" | "info";
export interface ToneVisual {
  fill: "solid" | "tint" | "outline-dashed";
  icon: IconName;                      // from @callibrator/icons — a NAME, never a component
  light: { fg: Hex; bg: Hex; border: Hex };
  dark: { fg: Hex; bg: Hex; border: Hex };
}
export const TONES: Readonly<Record<StatusTone, ToneVisual>>;
```

**Split of the registry:** *what a state means* (`device.retired → draft`, label key) is domain
knowledge and moves to `@callibrator/domain` (`05` § 6); *how a tone looks* moves here; the *label
words* move to `@callibrator/i18n` (`04`). Copper (the primary) and the tenant brand **never** appear
in a tone (as built). Priority (`priority.ts`) is not a status and never uses a tone (as built).

Both platforms render a tone as **shape + icon + text**; React Native supports `borderStyle:
"dashed"`, so `draft` keeps its dashed outline natively. An icon is never the only carrier of
meaning: the label is always rendered (or, in a dense native list cell, exposed as the cell's
accessibility label — `../MOBILE/10`).

## 6. Typography

| Token | Web (as built) | Native (target) |
|---|---|---|
| `fontFamily.body` | Inter (self-hosted via `next/font`, `--font-inter`) | the **system** font (SF Pro / Roboto) — native feel |
| `fontFamily.display` | Space Grotesk (`--font-space-grotesk`) | Space Grotesk, bundled with `expo-font` (OFL) — headings and the wordmark only |
| `fontFamily.mono` | JetBrains Mono (`--font-jetbrains`) | JetBrains Mono, bundled (OFL) — serial and QR numbers, tabular values |

The native choices are the proposal of this document; `../MOBILE/03` and `../MOBILE/90` (ADR-135)
decide the app's usage and win where they differ.

- **Scale** in logical pixels at 1×: `xs 12 · sm 14 · base 16 · lg 18 · xl 20 · 2xl 24 · 3xl 30`
  (the web emits `rem` = px / 16). Line heights and weights alongside.
- **Native text scales with the user's setting** (Dynamic Type / font scale); tokens never set
  `allowFontScaling: false`. Layouts must survive 200 % (`../MOBILE/10`).
- `fontVariant: ["tabular-nums"]` / `font-variant-numeric: tabular-nums` for measured values and
  dates in tables.

## 7. Space, Radius, Elevation, Motion

- **Space:** a 4-px base scale (`0, 1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40, 12=48, 16=64`),
  matching Tailwind's default steps the web uses today.
- **Touch targets:** `target.min = 44` (pt/dp; the web's public toggle is 44, the dense dashboard
  chrome 40 — ADR-122). Native controls use ≥ 44 always; ≥ 48 on Android where the platform guideline
  asks it.
- **Radius:** `sm 4 · md 6 · lg 8 · xl 12 · full 9999`.
- **Elevation:** each level is a pair — a web `box-shadow` string and a native `{ elevation,
  shadowColor, shadowOpacity, shadowRadius, shadowOffset }`.
- **Motion:** durations `fast 120 · base 200 · slow 320` ms and standard easings; **every animation
  is optional** — the web honours `prefers-reduced-motion` (as built, `globals.css`), the app
  honours `AccessibilityInfo.isReduceMotionEnabled()`.

## 8. Breakpoints and Window Classes (Phone and Tablet)

| Platform | Tokens | Source |
|---|---|---|
| Web | `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536` (px) | Tailwind 4 defaults, as built (`globals.css` defines no custom breakpoint — verified 2026-10-08) |
| Native | window class by **width in dp**: `compact < 600`, `medium 600–839`, `expanded ≥ 840`; height class `compact < 480` (phone landscape) | Material 3 window size classes; used on iOS too, so one rule decides layout on both |

`windowClass(width, height)` is a pure function in the package. The layouts each class gets —
split view (list + detail) from `medium` in landscape and from `expanded` always, the two-column IPM
checklist, dashboards, hardware-keyboard focus order — are decided in
[`../MOBILE/03-RESPONSIVE-PHONE-TABLET.md`](../MOBILE/03-RESPONSIVE-PHONE-TABLET.md); tokens supply
only the thresholds, so the two documents cannot disagree on a number.

## 9. The React Native Theme Object

```ts
// packages/tokens/src/index.ts (target API)
export interface Theme {
  scheme: "light" | "dark";
  color: Palette;                     // primary already brand-derived for this scheme
  tone: Readonly<Record<StatusTone, { fg: Hex; bg: Hex; border: Hex; fill: ToneVisual["fill"]; icon: IconName }>>;
  space: typeof space; radius: typeof radius; type: TypeScale; elevation: NativeElevation; motion: Motion;
}
export function createTheme(scheme: "light" | "dark", options?: { brand?: string | null }): Theme;
```

`createTheme` is pure. The app chooses `scheme` from the user's choice or `useColorScheme()` (one
theme preference per user, mirroring the web's one write path of ADR-122 § 5 — but stored natively)
and provides the object through its own context (`../MOBILE/01`). The web does **not** use
`createTheme`; it uses the CSS variables.

## 10. Tests and Gates

- **Contrast (ADR-090):** every text/background pair, in both themes, ≥ 4.5:1 — on page, card and a
  tone's own tint; boundaries and chart series ≥ 3:1. The test imports the objects (not a parsed
  stylesheet) and runs at the package's **100 %** gate.
- **Generated output current:** `tokens:check` in CI (regenerate, diff, fail).
- **Brand derivation:** `brandColor.test.ts` moves with the function; its drift check against
  `globals.css` becomes a check against the package's surfaces.
- **No platform import** (`90` § 5).

## 11. Bad Implications

- `globals.css` stops being the place a designer edits a colour; the edit is in TypeScript, then a
  generated file. Documented in `../UI-UX/` when P35-02 lands.
- The committed generated CSS is a second copy of the values — deliberately, so the web build needs
  no generator step, and guarded by `tokens:check`.
- Native fonts differ from the web's body font (system vs Inter) by decision; screenshots across
  platforms will not match pixel for pixel, and must not be required to.
