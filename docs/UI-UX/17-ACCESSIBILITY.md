# 17 — Accessibility

Target: **WCAG 2.1 Level AA**, on every surface, in both themes.

The verification page is held to a higher standard than the rest, because it is used once, by someone with no training, on their own device, and the outcome carries regulatory weight.

---

## Colour

| Rule | |
|---|---|
| Body text | 4.5:1 |
| Large text (18pt+, or 14pt bold) | 3:1 |
| UI components, graphical objects | 3:1 |
| Focus indicator | 3:1 against adjacent colours |
| **Both themes checked** | a pair that passes in light and fails in dark is a failure |

### Never colour alone

Around 8% of men have a colour vision deficiency, and the most common types make red and green hard to separate — which is exactly the compliant/overdue distinction this product depends on.

**Every status badge carries text.** A red dot is not a status.

This is not only accessibility: a printed or photocopied certificate loses colour entirely, and the verification page is read in whatever light the auditor is standing in.

## Keyboard

Everything operable by keyboard. No exceptions, including the Kanban board.

| Requirement | |
|---|---|
| Logical tab order following visual order | |
| **Visible focus indicator, always** — never `outline: none` without a replacement | |
| Skip link to main content | |
| Escape closes modals and drawers |, restoring focus to the trigger |
| Focus trapped inside a modal while open | |
| Enter and Space activate controls as expected | |
| Arrow keys within composite widgets — tables, tabs, menus | |

### The Kanban board

Drag-and-drop must have a keyboard equivalent: select a card, move it with arrow keys or a "move to column" action. A board that is drag-only is unusable without a mouse, and it is one of the screens `TECHNICIAN` and `SUPERVISOR` are granted write on.

## Screen Readers

| Requirement | |
|---|---|
| Semantic HTML first, ARIA second | a correct `<button>` beats `role="button"` |
| Every form control has an associated `<label>` | never placeholder-as-label |
| Errors linked to fields via `aria-describedby` | |
| Live regions for async outcomes — save results, arriving notifications | |
| Tables use `<th>` with `scope` | |
| Landmarks: `<nav>`, `<main>`, `<aside>` | |
| Images have alt text; decorative images have `alt=""` | |
| Icon-only buttons have accessible names | |

### Announce what changed

A save that succeeds must announce it. A toast alone is insufficient — it is missed by anyone whose screen reader has moved on, and by anyone not looking at that corner.

Anything consequential is persisted in the page, not only in a toast (P3, [`10-COMPONENT-SPECIFICATION.md`](./10-COMPONENT-SPECIFICATION.md)).

## Forms

| Requirement | |
|---|---|
| Label above, always | |
| Required indicated on the field, programmatically **and** visually | |
| Errors inline beside the field, **plus a summary** at the top | |
| The summary links to each failing field | |
| Server 400 field errors map back to their fields | the API returns field detail |
| Numeric fields declare numeric input modes | |
| No time limits on any form | someone may be interrupted mid-calibration |

The error summary matters most on the calibration form, where a field-level error below the fold is invisible to someone who submitted from the top.

## Motion

`prefers-reduced-motion` is honoured as a **full alternative**, not a degraded one.

With motion off, the landing page resolves to a complete static layout — not one with elements stuck mid-transition. The test: does the page still say everything it was going to say?

**Motion is never the only signal** for anything ([`16-MOTION-MICROINTERACTION.md`](./16-MOTION-MICROINTERACTION.md)).

## Zoom and Reflow

| Requirement | |
|---|---|
| Usable at **200% zoom** without horizontal scrolling | WCAG 1.4.10 |
| Text resizable to 200% without loss of content | |
| No fixed-height containers that clip text | |

At 200%, dashboard tables reflow to cards — the same treatment as the mobile breakpoint, which is why building the card layout serves both.

## Typography for Readability

| Rule | |
|---|---|
| Line height 1.5 for body, 1.4 minimum for mono | |
| Measure 60–75 characters for prose | |
| **No all-caps body text** — slower to read, harder for dyslexic readers | |
| Sentence case for headings and labels | |
| **Never truncate a serial number, certificate number or measurement** | wrap, or widen the column |

Truncation is an accessibility failure as well as a data one: a truncated serial is a shape that looks like a serial, and a screen reader announces it as such.

## The Verification Page

Held to the highest standard in the product.

| Requirement | |
|---|---|
| The verdict is a **heading**, not a styled `<div>` | |
| The **word** carries the message; colour reinforces | |
| Legible in greyscale | it will be photocopied |
| No JavaScript dependency for the verdict | |
| Works at 200% zoom on a small phone | |
| No motion | |

The auditor has no training, no account, one device and one attempt.

## Language

`lang` declared on the document. Indonesian role display names (Admin Faskes, Teknisi, IPSRS, Penyelia) inside English interface text are marked with `lang="id"` so a screen reader pronounces them correctly.

That mix is deliberate, not an unfinished translation.

## Testing

| Layer | Tool |
|---|---|
| Automated | `axe` in the component and browser suites |
| Keyboard | manual, tab through every screen |
| Screen reader | NVDA and VoiceOver on the critical paths |
| Zoom | 200%, every screen |
| Colour | contrast checks in **both** themes |
| Reduced motion | every animated surface |

Automated tools catch roughly a third of WCAG failures. **Keyboard-only navigation of the calibration form and the verification page is the manual test that must not be skipped** — those are the two screens where a failure has a consequence beyond inconvenience.

## Acceptance

See [`18-UX-ACCEPTANCE-CRITERIA.md`](./18-UX-ACCEPTANCE-CRITERIA.md). Accessibility criteria are release gates, not aspirations.
