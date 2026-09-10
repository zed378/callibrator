# 03 — Personas

Six personas, each mapped to the roles they actually hold. A persona that does not map to a role in [`../PLAN/03-USER-ROLES.md`](../PLAN/03-USER-ROLES.md) is a story, not a user.

---

## Rina — Biomedical Engineering Manager

**Role:** `ENGINEERING MANAGER` (level 7) · **Frequency:** daily, briefly

Runs the biomedical engineering department at a 400-bed hospital. Answerable to the hospital director when KARS surveyors arrive.

**Needs:** to know within seconds whether anything is out of interval; to produce the compliance report without asking anyone; to see who did what.

**Reality of her permissions:** read across everything operational, write only on kanban and tickets. She monitors and reports; she does not enter data.

**What breaks her day:** a dashboard tile that shows zero because a query failed. She will act on that number in a meeting.

**Design consequence:** P3 — never fake certainty. Every tile distinguishes unavailable from zero.

## Budi — Biomedical Technician

**Role:** `TECHNICIAN` (level 5) · **Frequency:** many times a day, on a phone or a shared workstation

Performs calibrations and maintenance. Fills in the record at the end of a job, often standing, often tired.

**Needs:** to find a device by serial number in one action; to enter a result without a form that fights him; to know what is due next.

**Reality of his permissions:** read on warehouse and equipment, write on kanban and raise-tickets. He works through the calibration and maintenance screens under `equipment`.

**What breaks his day:** a calibration form crammed above the fold, or a serial-number search that requires exact case.

**Design consequence:** P7 — the calibration entry form is spacious even though the device register is dense.

## Sari — Warehouse Staff

**Role:** `WAREHOUSE STAFF` (level 4) · **Frequency:** continuously during a shift

Moves stock, receives deliveries, runs opname. Uses one screen almost exclusively.

**Reality of her permissions:** **write on `warehouse`** — more than a `SUPERVISOR` at level 6 has. She is the one who moves stock; a supervisor approves it.

**Needs:** a transfer to take three actions, not eight; the state of an in-flight transfer to be obvious; low stock to be visible without looking for it.

**What breaks her day:** a quantity that changed with no record of why — which is currently possible via `PATCH /stocks/:id`.

**Design consequence:** every quantity change in the UI routes through adjustment, transfer or opname, each of which captures a reason.

## Pak Hendra — Facility Maintenance (IPSRS)

**Role:** `FACILITY MAINTENANCE` (level 4) · **Frequency:** several times a week

Hospital facilities engineering. Sees devices and warehouses read-only; raises tickets when something is wrong.

**Notably absent from his menu:** `dashboard`. He gets `home`, `warehouse`, `equipment` and `tickets-raise`.

**Design consequence:** the raise-a-ticket flow has to work for someone who is not a daily user of the system and does not know its vocabulary. It cannot assume he knows what a "non-conformance" is.

## Dewi — Calibration Provider Administrator

**Role:** `CALIBRATOR ADMIN` (level 8) · **Frequency:** daily

Runs an accredited calibration laboratory serving several hospitals. Her tenant is a **provider**, not a facility.

**Needs:** to manage the device estate she is contracted for; to issue and sign certificates; to keep the lab's own quality system (QMS, SOP, risk) in order for ISO 17025.

**Reality of her permissions:** write on equipment, risk, predictive-maintenance, qms, sop, workflows, kanban; read on warehouse and finance.

**What she cares about that a facility does not:** measurement uncertainty, the reference standard, and the certificate signing chain. She is the reason `uncertaintyBudget` is a first-class device column.

**Design consequence:** the certificate screen shows `calibratedBy`, `approvedBy` and `signedBy` as three distinct people, because separation of duties is what her accreditation depends on.

## Andi — Platform Operator

**Role:** `SUPERADMIN` (level 10) · **Frequency:** as needed

Runs the platform. Creates tenants, answers the support desk, investigates incidents.

**Reality:** bypasses every permission check and every tenant predicate. There is no second gate behind him.

**Cannot raise a support ticket** — he holds `tickets-response` and not `tickets-raise` (BR-13). This will look like an omission and is not.

**Design consequence:** every super-admin action is audited, and impersonation must be visibly distinguishable in the audit trail from the user acting themselves. Also: the confirmations on tenant suspension and IP allowlist must name what will be true afterwards, because both can lock him out.

---

## The Seventh Reader: the auditor

Not a user. Has no account, and will never have one.

An accreditation surveyor or a regulator who is handed a certificate and a phone.

**Needs:** to type or scan a certificate number and get an unambiguous answer.

**Design consequence:** `/verify/[certificateNumber]` is public, unauthenticated, works without heavy client dependencies, and puts the verdict — valid, expired, revoked, not found — first and at size. No animation. An auditor holding a phone wants the answer, not a reveal.

This is the one screen where a design failure has a regulatory consequence, and the one screen most likely to be forgotten in a redesign because nobody who works on the product uses it.

---

## Frequency Shapes Everything

| Persona | Frequency | Implication |
|---|---|---|
| Sari | continuously | one screen, optimised hard, no onboarding needed after week one |
| Budi | many times daily | fast entry, forgiving search |
| Dewi, Rina | daily, briefly | the dashboard has to answer in seconds |
| Hendra | weekly | cannot assume vocabulary or memory |
| Andi | as needed | needs confirmations that state consequences |
| Auditor | **once, ever** | must work with zero prior exposure |

The two extremes — Sari and the auditor — pull in opposite directions, and neither can be compromised for the other. That is why they are on different surfaces.
