# Phase 11 — Admin Dashboard Revamp

**Status:** ⏸ **ON HOLD — awaiting owner instruction** (owner decision, 2026-09-29). Nothing in this file may start until the owner says so. · **Planned:** 2026-09-29, placeholder only · **Decision record:** none yet; Phase 11 will need its own ADR before any card moves, because it changes `docs/UI-UX/` documents the dashboard follows today.

**Why this file exists now:** the landing, sign-in and verification revamp was split out as **Phase 10** (ADR-098) so it could run now; the dashboard revamp was deliberately **not** started. This file holds its place in the roadmap and points at the research already done, so nobody re-does it or starts it early.

**Research already available (inputs, not decisions):**

- [`../docs/UI-UX/research/01-current-ui-audit.md`](../docs/UI-UX/research/01-current-ui-audit.md) — the current dashboard audited menu by menu: shell, menu inventory, page-by-page findings, cross-cutting inconsistencies, heuristic evaluation, design system, top 15 issues
- [`../docs/UI-UX/research/02-standards-and-benchmarks.md`](../docs/UI-UX/research/02-standards-and-benchmarks.md) — Fiori, ServiceNow, Carbon, Atlassian, Salesforce patterns; WCAG 2.1 AA in dense tables and forms; 21 CFR Part 11 and ISO/IEC 17025 as UI; ID/EN locale formats; a prioritised pattern library (§6)
- [`../docs/UI-UX/research/03-personas-and-flows.md`](../docs/UI-UX/research/03-personas-and-flows.md) — role inventory, the effective role → menu matrix, proto-personas, key journeys, role-specific homes, a proposed information architecture, open questions for the owner

**Owner direction recorded in that research (to be confirmed when Phase 11 starts):** enterprise-dense (SAP/ServiceNow-like); a collapsible sidebar grouped by domain; comfortable density with a compact toggle; a home page per role; a neutral palette plus one accent (the tenant brand) in light and dark; the existing design system kept and tidied; desktop first, tablet usable; WCAG 2.1 AA; Indonesian and English.

**Placeholder scope.** The cards below are the shape the research suggests, **not** a plan the owner approved. Their titles, order and existence are all open. Every card is BLOCKED.

| Card | Title (placeholder) | Status |
|---|---|---|
| P11-00 | Owner instruction and scope confirmation; Phase 11 ADR | BLOCKED — awaiting owner instruction |
| P11-01 | Dashboard language: adopt ID/EN (reuse or migrate Phase 10's dictionaries; `next-intl` decision) | BLOCKED — awaiting owner instruction |
| P11-02 | Density tokens (comfortable / compact) and the page floorplans | BLOCKED — awaiting owner instruction |
| P11-03 | Shell: domain-grouped collapsible sidebar | BLOCKED — awaiting owner instruction |
| P11-04 | Role homes (worklist vs overview) | BLOCKED — awaiting owner instruction |
| P11-05 | List, object-page and form patterns across modules | BLOCKED — awaiting owner instruction |
| P11-06 | Accessibility, performance and live E2E verification | BLOCKED — awaiting owner instruction |

---

### P11-00 — Owner instruction and scope confirmation

| | |
|---|---|
| **Status** | BLOCKED — awaiting owner instruction |
| **Depends on** | the owner's go-ahead |
| **Spec refs** | docs/UI-UX/research/01-current-ui-audit.md · 02-standards-and-benchmarks.md · 03-personas-and-flows.md · docs/UI-UX/00-DESIGN-DIRECTION.md |
| **Spec required** | yes, when unblocked |

**Why:** the dashboard is where operators work every day; a redesign there changes the documents every module follows (`00`, `02`, `06`, `09`, `10`, `11`, `15`, `17`). It needs the owner's instruction, a confirmed scope, and an ADR before any code.

**Definition of Done**
- [ ] The owner's instruction recorded (date, scope, what is out)
- [ ] The research's open questions (03 §7) answered or listed in `TASKS/BACKLOG.md`
- [ ] A Phase 11 ADR amending the affected `docs/UI-UX/` documents
- [ ] The cards below replaced by a real plan in this file's anatomy

**Abuse cases**
- Starting any P11 card because Phase 10 "is nearby" or shares components
- Letting Phase 10's public tokens leak into the dashboard (ADR-098 scopes them to `data-surface="public"`)

The remaining placeholder cards (P11-01 … P11-06) get their full anatomy (Depends on, Spec refs, DoD, Abuse cases) when P11-00 is done. Until then they carry no DoD on purpose: a DoD written before the owner's scope would be invented.
