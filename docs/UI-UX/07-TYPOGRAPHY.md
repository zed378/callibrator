# 07 — Typography

---

## The Requirement That Shapes Everything

This product displays **serial numbers, certificate numbers, measurements and uncertainties**, and people transcribe them onto paper and read them back to auditors.

A typeface where `0` and `O`, `1` and `l` and `I`, or `5` and `S` are hard to tell apart is a typeface that produces transcription errors in a compliance record.

That single requirement outranks every aesthetic consideration in this document.

## Two Families

| Role | Family | Used for |
|---|---|---|
| Interface | a humanist sans with clear numerals | everything |
| Data | a monospace with **slashed or dotted zero** | serial numbers, certificate numbers, measurements, hashes, IDs, code |

Rules for the mono face:

- **Slashed or dotted zero, mandatory.** A plain `0` next to an `O` in a serial number is a defect.
- Tabular figures, so columns of numbers align.
- Used for any value a human will transcribe or compare character by character.

## The Scale

A modest scale. Compliance software does not need eight heading sizes; it needs three that are unmistakably different.

| Token | Use |
|---|---|
| `display` | the verification verdict, and nothing else |
| `h1` | page title |
| `h2` | section |
| `h3` | subsection, card title |
| `body` | default |
| `body-sm` | table cells, dense lists |
| `caption` | metadata, timestamps, helper text |
| `mono`, `mono-sm` | data |

`display` exists for one screen: `/verify/[certificateNumber]`. The verdict — VALID, EXPIRED, REVOKED, NOT FOUND — is the largest thing in the product because it is read at arm's length off someone else's phone.

## Line Length and Height

| Content | Measure |
|---|---|
| Body prose | 60–75 characters |
| Table cells | as needed, but wrap rather than truncate anything transcribable |
| Blog and news | 65–75 characters |

Line height: 1.5 for body, 1.2–1.3 for headings, **1.4 minimum** for mono data so adjacent characters do not visually merge.

## Truncation

**Never truncate a serial number, certificate number, or measurement.** Wrap, or give the column room.

A truncated `IP-2024-008…` is not a serial number; it is a shape that looks like one. If space is genuinely unavailable the column is in the wrong table.

Truncation with an ellipsis is acceptable for names, descriptions and free text, with the full value available on hover and to assistive technology.

## Numerals

| Context | Setting |
|---|---|
| Tables, any column of numbers | **tabular** |
| Prose | proportional |
| Measurements with uncertainty | mono, tabular |

A measurement is displayed with its uncertainty, never alone:

```
35.2 ± 0.3 °C
```

"35.2 °C" on its own is not a measurement, it is a number ([`../PLAN/07-CALIBRATION-PROGRAM.md`](../PLAN/07-CALIBRATION-PROGRAM.md)). The typography should make the pair feel like one value, not two.

## Dates

Unambiguous, always. `14 Mar 2026`, never `03/14/26` or `14/03/26` — the product serves Indonesian and international users and the two conventions are silently contradictory.

Relative time ("2 days ago") is permitted **only** alongside the absolute value, never instead of it. An audit trail entry that says "3 months ago" is useless in an investigation.

## Weight

Three weights: regular, medium, semibold. Bold is reserved for the verification verdict.

Emphasis in the dashboard is carried by **size and space**, not by weight. A screen where four things are bold has nothing emphasised.

## Case

| Rule | |
|---|---|
| Sentence case for headings and labels | Title Case reads as marketing |
| Never all-caps for body text | it is slower to read and harder for dyslexic readers |
| All-caps permitted for short status badges only | and always with the accompanying word, not colour alone |

## Loading

Fonts must not cause a visible reflow of a numeric column. Use `font-display: swap` with a metric-compatible fallback stack, or preload the mono face.

A serial-number column that shifts when the webfont lands is the same failure as truncation: the reader loses their place mid-transcription.

## Localisation

Interface English; seeded role display names Indonesian (Admin Faskes, Teknisi, IPSRS, Penyelia). The typeface must carry Indonesian diacritics cleanly.

That mix is deliberate, not an unfinished translation — an accreditation surveyor reads the role on the screen.

## Print

Certificates are rendered to PDF by puppeteer from templates in `backend/src/templates`, using a **separate** stylesheet.

The PDF is the artefact an auditor holds. Its typography is governed by what survives printing, scanning and photocopying — which means higher contrast, larger minimum sizes, and no reliance on colour at all.

Dashboard print styles matter far less; nobody prints the dashboard.
