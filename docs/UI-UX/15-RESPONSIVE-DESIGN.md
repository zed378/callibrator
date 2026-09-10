# 15 — Responsive Design

Mobile is not a courtesy in this product. Two of the six personas do their primary work on a phone, and the seventh reader — the auditor — is always on one ([`03-PERSONAS.md`](./03-PERSONAS.md)).

---

## Who Is Actually on a Phone

| Persona | Device | Context |
|---|---|---|
| **Budi**, technician | phone | standing, end of shift, recording a calibration |
| **Sari**, warehouse | phone or trolley tablet | walking a shelf during opname |
| **The auditor** | their own phone | once, ever, in unknown light |
| Rina, Dewi, Andi | laptop | desk work |

The first three cannot be compromised for the last three.

## Breakpoints

Tailwind defaults, unmodified.

| | Width | Dashboard behaviour |
|---|---|---|
| base | <640 | sidebar → drawer; tables → cards; single column |
| `sm` | 640 | |
| `md` | 768 | two-column forms collapse to one |
| `lg` | 1024 | sidebar persistent |
| `xl` | 1280 | full layout |
| `2xl` | 1536 | content capped at 1440px |

## Tables Become Cards, Not Scrollers

Below `sm`, every list renders as cards.

A horizontally scrolling table is unusable one-handed: the columns that matter are off-screen, and scrolling horizontally in a vertically scrolling page is a fight.

```
┌─────────────────────────────────┐
│ Infusion Pump B-Braun           │
│ IP-2024-00871                   │  ← mono, never truncated
│ ● Active   ● Overdue            │  ← both badges
│ Due 14 Mar 2026 · Gudang A      │
└─────────────────────────────────┘
```

The card keeps what the table row kept: the serial in full, both status badges, and the due date. Truncating a serial to fit a card is the same defect as truncating it in a table.

The one exception is the **Kanban board**, where horizontal scrolling is the content.

## Touch

| Rule | |
|---|---|
| Targets **44×44px minimum** | |
| 8px minimum between adjacent targets | |
| Primary action within thumb reach | bottom of the viewport, not the top right |
| No hover-only affordances | anything revealed on hover has a tap equivalent |
| Numeric fields get numeric input modes | |

Hover-only is the one that slips through: a row action that appears on hover is invisible on touch, and it is invisible in exactly the density-optimised tables that get used most.

## Forms on a Phone

Budi records a calibration standing up, tired, one-handed.

| Rule | |
|---|---|
| **The save control is never below a scroll** on the forms that matter | |
| Single column below `md` | |
| Labels above fields, always | placeholder-as-label disappears when typing |
| Numeric keyboards on measurements and quantities | |
| Field-level errors visible without scrolling to find them | |
| No autosave in the compliance path | a calibration record is saved deliberately |

## Sidebar

| Width | Behaviour |
|---|---|
| `lg`+ | persistent, 256px, collapsible to 64px |
| below `lg` | drawer, opened from the header, closes on navigation |

The drawer closes on navigation. A drawer that stays open after a tap covers the screen the tap was meant to reach.

## The Verification Page

The most demanding responsive case in the product, because there is no fallback: the auditor has one device, no account, and one attempt.

| Requirement | |
|---|---|
| Verdict readable at arm's length | `display` size, at every width |
| No horizontal scroll at any width | |
| Works on an old, slow, untested phone | |
| No heavy client dependencies | |
| Legible in poor light and in greyscale | the word, not the colour |

It is also the screen with the fewest elements, which makes getting it right cheap — provided anybody remembers to check it.

## Opname on a Phone

Sari counts stock walking a shelf.

| Requirement | |
|---|---|
| One item per screen, or a very short list | |
| Large numeric input | a mis-tap writes a wrong figure into a reconciliation |
| A visible running position | "12 of 84" |
| Fully one-handed | the other hand is holding something |

This is the one warehouse screen that is spacious rather than dense, for exactly this reason.

## What Does Not Need Mobile

Some screens are legitimately desktop-first, and pretending otherwise wastes effort:

| Screen | Why |
|---|---|
| Kanban board | horizontal space is the content |
| Audit trail with filters | investigation work, done at a desk |
| Role and permission matrix | a grid, and it is a grid on purpose |
| Tenant hierarchy tree | |
| Reports with many columns | exported and read elsewhere anyway |

These degrade to "usable, not optimised" below `lg`. That is an accepted trade-off, not an oversight — but they must remain **usable**, not broken.

## Orientation

Portrait is the default for every mobile case. Nothing requires landscape.

Landscape must not break layout, but no screen is designed for it: nobody rotates a phone to record a calibration.

## Testing

| Case | Why |
|---|---|
| 375px viewport | the small-phone floor |
| Slow 3G | hospital wifi is not always good |
| Touch-only, no hover | catches hover-only affordances |
| Zoomed to 200% | WCAG reflow ([`17-ACCESSIBILITY.md`](./17-ACCESSIBILITY.md)) |
| Verification page on a real, old device | the one case a simulator does not settle |
