# 00 — Design Direction

The public surfaces (landing, sign-in, request access, verification) are specified by [`20-LANDING-AUTH-REVAMP.md`](./20-LANDING-AUTH-REVAMP.md), which supersedes Part I of [`19-IMMERSIVE-REVAMP-PLAN.md`](./19-IMMERSIVE-REVAMP-PLAN.md) (ADR-098). This document is the direction that governs everything, including the dashboard neither covers.

---

## The Position

**Precision as immersion.**

Callibrator is software for people whose job is to be exactly right about measurements, and whose evidence is inspected by auditors. The design has to earn trust from a biomedical engineer, survive an accreditation surveyor reading it over someone's shoulder, and still be usable by a warehouse clerk at 6am.

That rules out two default aesthetics:

- **Consumer-SaaS friendliness** — rounded, chatty, illustrated. It reads as unserious in a clinical context.
- **Enterprise-grey resignation** — dense grids, no hierarchy, everything the same weight. It reads as untrustworthy in a different way: if the software does not distinguish what matters, the operator will not either.

The direction is closer to instrumentation than to either: high contrast, exact alignment, restrained colour used to mean something, generous space around the numbers that matter.

## Two Audiences, Two Registers

| Surface | Audience | Register |
|---|---|---|
| Public — landing, blog, news | evaluators, procurement | confident, evidenced, unhurried; motion is permitted |
| Dashboard | daily operators | fast, dense where density helps, quiet; motion is minimal |

The public surfaces may spend a budget on impression. The dashboard may not spend anything on it. A technician logging a calibration at the end of a shift is not an audience for an animation.

## Principles That Drive Layout

Full list in [`01-DESIGN-PRINCIPLES.md`](./01-DESIGN-PRINCIPLES.md). The three that shape most decisions:

**1. State before decoration.** The first thing on a screen is what is true — how many devices are overdue, whether this certificate is signed. Ornament comes after, or not at all.

**2. Absent, not disabled.** An unauthorised surface does not appear. The sidebar is rendered from the server-resolved menu tree, so users never see a door they cannot open. Greyed-out menus teach people that the software is arbitrary.

**3. Never fake certainty.** A number that could not be computed shows as unavailable, not as zero. In a compliance tool, a confidently wrong figure is worse than a blank.

## Colour Carries Meaning

Colour is not theming. In this product it is status, and status is regulatory.

| Meaning | Use |
|---|---|
| Compliant / current | the calm state — most of the screen, most of the time |
| Due soon | attention, not alarm |
| Overdue / non-conformant | alarm, and only here |
| Draft / pending | neutral, unfinished |
| Revoked / rejected | terminal negative |

The consequence: the brand accent cannot be the same hue as any status colour, or a decorative element will read as a warning. Tenant branding (`tenants.primaryColor`) is applied to chrome and identity, **never to status**.

That constraint is inherited by every tenant-branded deployment, and it is the reason branding is scoped rather than global. Details in [`08-COLOR-SYSTEM.md`](./08-COLOR-SYSTEM.md).

## Density

Dense where the user is scanning for an exception; spacious where the user is entering data they must get right.

| Screen | Density |
|---|---|
| Device register, stock list, audit trail | dense — scanning |
| Calibration entry, certificate signing | spacious — precision |
| Dashboard | mixed — headline figures spacious, supporting lists dense |

A calibration form crammed to fit above the fold is how a wrong measurement gets typed.

## Motion

Motion is decoration on the public surfaces and a **state signal** in the dashboard — never the reverse.

Dashboard motion is limited to conveying that something changed: a new notification arriving, a row updating, a job progressing. It is always redundant with a non-motion signal, because `prefers-reduced-motion` must be honoured and because a moving element is unreadable to someone scanning.

See [`16-MOTION-MICROINTERACTION.md`](./16-MOTION-MICROINTERACTION.md).

## Language

**Public surfaces (ADR-098):** Indonesian by default, English by a visible toggle; language names are written in their own language, never as flags. Mechanism: `20-LANDING-AUTH-REVAMP.md` §5.

**Dashboard (unchanged until Phase 11 decides):** interface English; seeded role display names Indonesian (Admin Faskes, Teknisi, IPSRS, Penyelia) because the primary market is Indonesian healthcare and an accreditation surveyor reads the screen.

That mix is deliberate, not an unfinished translation. Domain vocabulary follows the users: **opname** is used throughout for a physical stock count because that is what the people doing it call it.

## Theme

Light and dark, both first-class — on every surface (amended by ADR-118 Am. 3 and ADR-122; this paragraph used to say the public surfaces were dark only, ADR-098 §3).

- **One family.** The public surfaces are warm light with a warm dark mode (`--pub-*` tokens, ADR-118). The dashboard follows the same family, tempered for density: warm neutral surfaces, charcoal ink, copper actions; espresso, ivory and light copper in dark (ADR-122, [`08-COLOR-SYSTEM.md`](./08-COLOR-SYSTEM.md) "The Dashboard Palette").
- **One mechanism and one default.** Until the user chooses, every surface follows the device's `prefers-color-scheme`. A choice is stored once (`hdc-theme-preference`), carries both ways between the landing and the dashboard, and "Use device setting" in the dashboard's user menu clears it. `ThemeInitScript` runs before paint to avoid a flash of the wrong theme.
- **A toggle on both surfaces**: the public header and auth shell (44 px), and the dashboard top bar beside the notification bell (40 px), both `aria-pressed`.

Dark is not an afterthought here: device and equipment areas of a hospital are often dim, and a screen that is the brightest object in the room is a screen people angle away from.

Contrast requirements hold in both (`17-ACCESSIBILITY.md`).

## What Good Looks Like

A biomedical engineer opens the dashboard and knows within two seconds whether anything needs them today.

An accreditation surveyor is shown a certificate verification page on a phone and believes it.

A warehouse clerk moves stock between two warehouses without reading any documentation.

None of those outcomes is achieved by making the software look impressive.
