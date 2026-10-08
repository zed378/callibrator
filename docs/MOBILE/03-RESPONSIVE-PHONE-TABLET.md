# 03 — Phone and Tablet Layouts (TARGET)

> **TARGET — nothing here is built.** Design direction: `docs/UI-UX/00` (precision, density where the
> user scans, space where the user enters data), `docs/UI-UX/15` (who is on a phone, touch rules),
> `docs/UI-UX/17` (accessibility). Breakpoint values are **tokens** in the shared `tokens` package
> ([`docs/SHARED/02-TOKENS.md`](../SHARED/02-TOKENS.md) § 8, `windowClass(width, height)`); the values
> below are that document's. If they ever differ, **the package wins** and this document is corrected.

---

## 1. Window Classes, Not Device Names

Layouts respond to the **current window width in density-independent points** (`useWindowDimensions`),
grouped into three classes. iPad Split View / Slide Over, Android split-screen and foldables all
change the window, not the device, so the class is read from the window.

| Class | Width (dp) | Source | Typical window |
|---|---|---|---|
| **compact** | < 600 | tokens § 8 | any phone, portrait or landscape (most); iPad Slide Over |
| **medium** | 600 – 839 | tokens § 8 | small tablet portrait; iPad half split; large phone landscape; unfolded foldable |
| **expanded** | ≥ 840 | tokens § 8 | tablet landscape; large tablet portrait |

The values are the Material 3 window-size classes, chosen because they are the documented platform
convention on Android and fit iPadOS's split widths; the web's Tailwind breakpoints (640/768/1024,
`docs/UI-UX/15`) are not reused for native, because points on a tablet are not CSS pixels on a
laptop. The tokens package also defines a **height** class: `compact` below 480 dp (a phone in
landscape) — used here to drop the bottom tab labels to icons-with-accessible-names and to keep the
capture stepper's pinned action visible. One hook, `useWindowClass()` (over the package's pure
function), is the only reader — no screen compares a raw width.

## 2. What Changes, and What Never Does

| Never changes across classes | Changes |
|---|---|
| what is shown (fields, statuses, the serial in full) — a card keeps what a row keeps (`docs/UI-UX/15` "Tables become cards") | how many panes |
| the order of actions and fields (focus order, `§ 7`) | navigation chrome (tabs ↔ sidebar, `§ 3`) |
| status = shape + icon + text (ADR-122 § 6) | columns in forms and checklists (`§ 5`) |
| touch targets ≥ 44 pt iOS / 48 dp Android | list density (cards on compact, a table-like list on expanded) |

## 3. Navigation Chrome — Chosen Once per Launch

- **Phone chrome** (bottom tabs, `02` § 4.1) when the device's **smallest width** is < 600 dp.
- **Tablet chrome** (sidebar, `02` § 4.2) when the smallest width is ≥ 600 dp: a **rail** (icons +
  short labels, 80 dp) in the medium class, a **full sidebar** (≈ 280 dp, collapsible to the rail) in
  the expanded class.

**Decision:** the chrome *type* (tabs vs sidebar) is chosen from the device's smallest width at launch
and kept for the session; only the rail ↔ full sidebar switch follows the live window. Reason:
swapping a tab navigator for a drawer navigator at runtime remounts the navigation tree and loses the
stack state — a technician rotating an iPad or opening Slide Over mid-capture must not lose their
place. Within tablet chrome, a window narrower than 600 dp (Slide Over) hides the sidebar behind a
menu button instead of switching to tabs.

## 4. Master-Detail (Split View)

On **expanded** (and medium landscape), list screens become two panes:

```
┌──────────┬─────────────────────┬───────────────────────────────────────┐
│ sidebar  │ Devices (list)      │ Infusion Pump B-Braun                  │
│          │ ▸ search / filters  │ IP-2024-00871   (mono, never truncated)│
│          │ ● Due  ◐ Draft      │ ● Active   ▲ IPM due   ✓ Calibrated    │
│          │ ─────────────────── │ Room 2.14 · ICU · Floor 2              │
│          │ ▶ Infusion Pump …   │ [Start IPM]  [Photos]                  │
│          │   Syringe Pump …    │ Last IPM 03 Oct 2026 · visit 14        │
│          │   Patient Monitor … │ …                                      │
└──────────┴─────────────────────┴───────────────────────────────────────┘
   rail/      ≈ 360 dp, scrolls       the rest; its own scroll and header
   sidebar    independently
```

- Implemented as `devices/_layout.tsx` rendering the list and a `<Slot />` for the detail on
  expanded, and a `Stack` on compact (`01` § 2.1). The **URL is the same** in both (`/devices/<id>`),
  so a deep link, a notification and a rotation all land on the same state.
- Selection is the route, not component state: rotating to compact shows the detail full-screen with
  a back control to the list; rotating back shows both, the selected row marked (`aria-selected` /
  `accessibilityState.selected`).
- Panes: Devices, IPM sessions, Certificates, Work orders, Notifications, Outbox (capture list ↔
  attention detail). **Not** the capture stepper (§ 5), which takes the whole content area.
- An empty detail pane says what to do ("Select a device"), never stays blank.

## 5. The IPM Checklist — Larger on a Tablet

The capture stepper is the screen technicians spend their day in; `docs/UI-UX/00` says it is a
**precision** screen: spacious, never crammed.

| Class | Layout |
|---|---|
| compact | one section per step; one item per row; the numeric keypad for measured values; **the step's primary action is pinned at the bottom** within thumb reach (`docs/UI-UX/15`) and never below a scroll; a step indicator "3 of 9 · Electrical safety" |
| medium | one section per step; items in **two columns** where the item kind is short (`check`, `tri_state`, `condition_clean`); measured items stay full-width with their limit and unit beside the input |
| expanded | a **section list** pane (≈ 280 dp: every section with its completion and any out-of-limit flag) + the **section editor** pane (two columns as medium); jumping between sections is a tap, not a sequence |

Rules in every class:

- Labels above fields; the unit and the limit visible next to the value (`MeasurementValue`,
  `docs/UI-UX/10`); an out-of-hard-range value is flagged inline with text, not colour alone.
- Missing required items are listed by section and label before submit — the same function the
  server uses (`missingRequiredItems`, shared `domain`).
- **Autosave is local only** (the outbox, `04`); "Submit" is a deliberate act with a confirmation
  that states what happens ("This IPM becomes a record. You can correct it later, not edit it").
  This keeps `docs/UI-UX/15`'s "no autosave in the compliance path" true for the **record**: the
  draft is saved locally; the record exists only when submitted.

## 6. Dashboards

| Class | Layout |
|---|---|
| compact | one column; headline figures first (overdue calibrations, IPM due, devices not fit for use), each a tappable tile leading to its filtered list; charts below, each full-width with direct labels |
| medium | two-column tile grid; charts span two columns |
| expanded | three-column grid; a facility filter as a persistent side pane for unbound managers |

Charts follow ADR-122 § 7 (categorical `--chart-1…5`, status series in status colours, direct labels,
≤ 5 colour series) with the native chart library chosen under the package rule (owner memory:
package swaps allowed when proven) — its accessibility (a data table alternative per chart, read by
the screen reader) is a selection criterion, not an afterthought. A figure that could not be computed
shows as unavailable, never as zero (`docs/UI-UX/00` "Never fake certainty").

## 7. Landscape, Hardware Keyboards and Focus Order

- **Orientation:** phones are portrait-first but **not locked** (the PWA manifest locks portrait;
  the native app does not, because rugged phones and phones in vehicle mounts are used in landscape,
  and WCAG 1.3.4 asks not to restrict orientation). Tablets support both. A landscape phone stays in
  the compact class unless its width reaches 600 dp.
- **Hardware keyboards** (tablets with a keyboard case are expected for heavy capture):
  - every control is reachable by **Tab / Shift-Tab** in visual order; arrow keys move within the
    checklist's item grid and lists; **Enter** activates; **Space** toggles a check; **Esc** closes a
    sheet or dialog and returns focus to its trigger;
  - shortcuts in the capture stepper: `⌘/Ctrl + →` / `←` next / previous section, `⌘/Ctrl + S` "save
    locally now" (a no-op that confirms — autosave already ran), `⌘/Ctrl + Enter` opens the submit
    confirmation (never submits directly); shortcuts are listed on a discoverable sheet (iPadOS: the
    `⌘`-hold menu; Android: `Meta + /`);
  - a **visible focus indicator** on every focusable element (the primary token ring of ADR-122 —
    `docs/UI-UX/17` "never `outline: none` without a replacement"); the platform focus system is used
    (`focusable`, iPadOS focus groups), not a custom one;
  - numeric fields accept typed decimals with a comma or a point (the shared parser, P19-01 § 7).
- **Focus order on layout change:** a rotation or pane change keeps focus on the same logical element
  if it is still visible; otherwise focus moves to the new pane's heading and the change is announced
  (`10` § 2).

## 8. Dynamic Type and Display Size

- Text follows the OS text size (iOS Dynamic Type, Android font scale) — `allowFontScaling` stays on;
  a `maxFontSizeMultiplier` cap is allowed **only** on fixed-height chrome (tab labels, badges) and
  never below 1.5; body text, labels, values and errors scale without a cap (WCAG 1.4.4).
- At the largest sizes layouts **reflow**: two-column checklists fall back to one column, tiles to one
  column, side-by-side label/value pairs stack (`useWindowClass()` combined with the font scale:
  a font scale ≥ 1.3 lowers the effective class by one step for content layout).
- Android **display size** (smallest-width change) is honoured by the window classes automatically.
- No information is carried by truncation alone: serials, QR codes and report numbers are never
  ellipsised; long names wrap.
