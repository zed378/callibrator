# <Task ID> — <Title>

**Date:** YYYY-MM-DD
**Task:** <ID from TASKS/, or "—" if this is not task work>
**Author:** <who>
**Spec refs:** <docs/ documents this implements>

---

## Hook

*One or two sentences that tell a future reader whether this is the record they need. Not a summary — the surprising part.*

*Good: "Approving a draft certificate threw a plain Error and surfaced as a 500, and there was no submit transition at all — so approval was unreachable in practice, and the 500 hid that."*

*Bad: "Implemented the certificate approval workflow."*

---

## What Changed

*Files, tables, endpoints, configuration. Enough for someone to find it. Not a diff — git has the diff.*

---

## Why

*The reasoning. What problem this solves, and why this shape rather than another.*

*If `docs/` already decided this, link to it and say nothing more. If `docs/` left it open, this is where the decision goes — and it probably needs an ADR too.*

---

## Alternatives Considered

*What was rejected, and why.*

*This section is the one a future reader needs most: it tells them whether their new idea was already evaluated, or genuinely never considered. "None" is a valid answer only when there genuinely was one obvious way.*

---

## What Surprised Me

*The part that cost the most time. A trap, a wrong assumption, a behaviour that was not what the documentation said.*

*This section is why the record exists. A record with an empty one is usually a record that was written a week late.*

---

## Tests

*Name them. An assertion that something was tested is not evidence.*

- Unit:
- Integration:
- Live E2E:
- Browser:
- **Two-tenant IDOR test** (required for any new `:id` route):
- **Mutation check** (did you break the thing and watch the right test fail?):

---

## Definition of Done

*Per `TASKS/00-TASK-CONVENTIONS.md`. Tick what passed. **Name what was waived and who agreed.***

- [ ] Code implements the spec
- [ ] Lint passes
- [ ] Tests pass at the coverage gate
- [ ] Build succeeds
- [ ] Permission gate on every new route
- [ ] Tenant isolation verified — two-tenant test asserting **404**
- [ ] Audit logging on every mutation, **inside the transaction**
- [ ] Documentation updated
- [ ] This record written

**Waived:** <which item, by whom, why — or "none">

---

## Security and Compliance

*Anything touching tenant isolation, authorization, audit, secrets, or evidence integrity.*

*If nothing, say "no security-relevant change" — do not leave it blank, because blank reads as "not considered".*

---

## What to Watch

*What might break because of this. What a future reader should check before assuming this still works.*

*Examples: a new `skipTenantScope`, a new raw query, a new cache key, a new fail-open default, a scheduled job that now runs on a different cadence.*

---

## What Was Not Determined

*Stated plainly. Something you could not verify, a test you could not run, an environment you had no access to.*

*"The Helm charts render; no cluster was reachable, so they are not known to deploy" belongs here. So does "verified individually, not in one uninterrupted run".*

*Rounding this up is how a status report becomes untrustworthy.*

---

## Follow-Ups

*Anything left. Add each to `TASKS/BACKLOG.md` so it has a consequence rather than only a mention, and link it here.*

---

## Links

- ADR: <if a decision was made>
- Changelog: <if user-visible or operationally significant>
- Backlog: <items raised>
- Related records:
