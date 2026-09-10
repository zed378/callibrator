# 04 — Form Architecture

Forms in this product write compliance records. A form that is hard to use produces a wrong measurement, and a wrong measurement is a defect an auditor finds.

---

## The Two Kinds

| Kind | Example | Treatment |
|---|---|---|
| **Compliance** | calibration record, certificate signing, stock adjustment, opname count | spacious, deliberate, no shortcuts |
| Administrative | user, role, tenant, feature flag | conventional |

Compliance forms get the space (P7). Budi records a calibration standing, tired, at the end of a shift — a form crammed to fit above the fold is how a wrong number gets typed.

## Structure

```
label            ← above, always
[ field ]
helper or error  ← immediately below
```

| Rule | |
|---|---|
| Label above, never placeholder-as-label | a placeholder disappears the moment typing starts |
| Required marked **on the field**, programmatically and visually | not inferred from an asterisk legend elsewhere |
| Errors inline, beside the field | **plus a summary at the top**, linking to each failing field |
| Numeric fields declare numeric input modes | |
| Single column below `md` | |
| **The save control is never below a scroll** on a compliance form | |

The error summary matters most on the calibration form: a field-level error below the fold is invisible to someone who submitted from the top.

## Validation

Client-side validation is a **convenience**. The server validates with Joi and is the authority.

```
on blur     → format and shape
on submit   → completeness
server 400  → field detail mapped back to the fields
```

The API returns field detail on a 400. **Use it** — mapping server errors back to their fields is what turns "validation failed" into "serial number already exists" beside the serial number.

## No Autosave in the Compliance Path

A calibration record is saved **deliberately**. There is no draft autosave, no save-on-blur, no optimistic write.

The record is append-only (BR-7): there is no edit path, so a half-typed value written by an autosave is a permanent half-typed value.

Administrative forms may autosave where it is genuinely useful. Nothing that produces evidence may.

## Append-Only, Said Early

Calibration records cannot be edited. A correction is a **new record** that supersedes the old one.

The form says this **in its helper text**, before the user needs it. Discovering the rule after typing a wrong value is a bad moment; discovering it while reading the form is not.

## Prefilling

| Form | Prefilled from |
|---|---|
| Calibration record | the device — `standard`, `calibrationIntervalDays`, `uncertaintyBudget` |
| Certificate | the calibration record it derives from |
| Transfer | the current warehouse |
| Stock adjustment | the item and location in context |

Prefilling from the source record is not a nicety: retyping a standard or a serial number is where transcription errors enter the data.

## Explicit Judgements Are Not Inferred

`isCompliant` on a calibration record is a **choice the technician makes**, never derived from the results.

"Within tolerance" depends on the uncertainty budget and on conditions the form does not model. A system that infers it is asserting something it cannot know, and the assertion ends up in evidence.

The same applies to a certificate's `meaning` at signing — the signer states it, the system records it ([`../DATABASE/08-CERTIFICATE-SIGNATURE-TABLES.md`](../DATABASE/08-CERTIFICATE-SIGNATURE-TABLES.md)).

## Measurements

Rendered and entered as a value **with** its uncertainty:

```
35.2  ±  0.3   °C
```

Mono, tabular figures, never truncated. A value entered without an uncertainty is incomplete, not a bare number ([`../UI-UX/10-COMPONENT-SPECIFICATION.md`](../UI-UX/10-COMPONENT-SPECIFICATION.md)).

The `results` shape is driven by the device's `uncertaintyBudget` (JSONB), so the form is not fixed — an infusion pump and a centrifuge do not have comparable measurement points.

## Destructive and Irreversible Submits

Confirmations state what will be **true afterwards**, not "are you sure" (P4).

Two refuse rather than warn, because neither has an in-product recovery:

| Action | Refusal |
|---|---|
| Suspending the tenant **you belong to** | blocked, naming the consequence |
| An IP allowlist excluding **your current address** | blocked, naming the address |

## Mobile

Budi and Sari are on phones.

| Rule | |
|---|---|
| Touch targets 44×44 minimum | |
| Numeric keyboards on every measurement and quantity | |
| Save reachable by thumb, never below a scroll | |
| Field errors visible without hunting | |
| No time limits, ever | someone may be interrupted mid-calibration |

The opname counting screen is one item per screen, large numeric input, with a visible running position — it is used walking a shelf, one-handed.

## React 19 Notes

| Pattern | |
|---|---|
| Controlled inputs | default |
| `setState` in an effect to sync a field | the compiler flags it — derive during render instead |
| `useMemo` / `useCallback` on handlers | usually unnecessary now |

Do not disable the compiler lint rules to make a form build. The rule is usually right about the component.

## Accessibility

| Requirement | |
|---|---|
| Every control has an associated `<label>` | |
| Errors linked via `aria-describedby` | |
| The error summary is focusable and announced | |
| Fieldsets and legends for grouped controls | |
| Focus visible at all times | |
| Submit result announced in a live region | a toast alone is not enough |

Keyboard-only completion of the calibration form is a manual release check ([`../UI-UX/18-UX-ACCEPTANCE-CRITERIA.md`](../UI-UX/18-UX-ACCEPTANCE-CRITERIA.md) UX-35).

## The Rich Text Case

`posts.contentHtml` is authored in TipTap and rendered into a **public** page. It is the stored-XSS surface of the system.

Two controls, both required:

1. Sanitise **on ingest** — sanitising only on render leaves the payload in the database for any other consumer.
2. Render under a CSP that does not permit inline script.

The API origin allows `'unsafe-inline'` for bundled swagger-ui. **That reasoning does not transfer** to the Next.js origin serving these pages.
