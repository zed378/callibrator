# Phase 5 — Analytics, Telemetry and Quality

**Status: 🟡 partially DONE.** Predictive maintenance and RAG shipped; **the data lake did not, deliberately.**

Written retrospectively. This phase also absorbed the entire quality-management surface, which was not in its original scope.

---

### P5-01 — Dashboard and reporting

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/PLAN/14-ANALYTICS-AND-REPORTING.md` · `docs/UI-UX/11-DASHBOARD-UX.md` |

**What shipped:** `GET /dashboard/metrics` — **one endpoint returning every tile** — plus five report endpoints.

**One endpoint, not twelve.** A dashboard that fans out is twelve round trips on a hospital network, twelve chances to leak a tenant predicate, and twelve independent failure modes on the screen people trust most.

**The rule that governs this screen:** a tile that could not be computed shows as **unavailable, not zero**. Rina reports the overdue count to the hospital director; a `0` that is actually a failed query is the most dangerous single pixel in the product.

Large exports run as **batch jobs**. Export is itself audited — `audit_logs.action` includes `EXPORT`, because knowing who extracted what is a compliance requirement.

---

### P5-02 — IoT telemetry

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** `iot_readings` (migration `0010`), ingest over HTTP **and over an embedded `aedes` MQTT broker inside the Express process**.

**Embedding the broker is unusual and deliberate.** A hospital deployment does not need a separate broker to accept device telemetry, which matters where every additional service is a procurement conversation.

The trade-off: it scales with the API process and does not survive its restart. For telemetry — where a dropped reading is a gap in a trend, not lost evidence — that is acceptable. It would not be acceptable on the calibration path.

**`isAnomaly` is computed at ingest**, against `calibration_devices.readingTolerance`. Anomaly detection that runs at query time cannot alert, which defeats the purpose.

**Telemetry is never a calibration result.** A device reporting itself in tolerance has not been calibrated; it has reported. Calibration needs a traceable reference standard and a competent human who signs for it. Treating telemetry as calibration would produce a certificate nobody can defend at audit — worse than no certificate.

`iot_readings` is the highest-volume table and the **only one purged by retention** rather than soft-deleted.

---

### P5-03 — Predictive maintenance

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** three endpoints deriving risk signals from IoT readings, maintenance history and calibration outcomes.

**There is no predictive-maintenance table.** The module computes over `iot_readings`, `maintenance_work_orders` and `calibration_records`. Worth knowing when looking for a model that does not exist.

**Everything it produces is a proposal.** `POST /recommendations/:deviceId/approve` is the human gate. Nothing here changes a calibration interval or dispatches a technician on its own, because an interval change is a quality decision with regulatory weight.

`recommendationReason` exists because a bare number nobody can justify gets ignored — and an unaccepted recommendation is wasted computation.

**Permissions match who owns the decision:** `CALIBRATOR ADMIN` writes, `HEALTHCARE ADMIN` reads. The provider proposes and adjusts; the facility reviews.

---

### P5-04 — AI assistant and RAG

| | |
|---|---|
| **Status** | ✅ DONE — **beyond the plan**, PostgreSQL only |

**What shipped:** `document_chunks` with a `vector(1536)` embedding (migration `0018`, which runs `CREATE EXTENSION vector`), OCR, and retrieval-augmented question answering.

**This is why compose uses `pgvector/pgvector:pg17`** rather than plain `postgres:17-alpine`.

**It is the honest exception to engine-agnosticism.** On MySQL the module is **unavailable** rather than differently implemented — a documented capability difference, not a portability claim.

**⚠ The highest-risk isolation surface in the system.** Vector similarity search does **not** scope itself. A retrieval omitting the tenant predicate returns another hospital's documents as context and paraphrases them into an answer — **with no error, and nothing in the response marking where the content came from**.

`document_chunks.tenantId` is indexed and the scoping hooks apply, but this is the module where a security review should look hardest.

**Per-tenant keys override the platform key.** That is a **data-residency control**, not a billing convenience: a tenant whose policy forbids sending data to a shared account can point at its own endpoint.

Unset provider configuration means `/ai` and the GDPR export path return errors. That is an environment condition, not a code defect.

---

### P5-05 — Quality management

| | |
|---|---|
| **Status** | ✅ DONE — **entirely beyond the original scope** |
| **Spec refs** | `docs/API/10-QMS-API.md` |

**What shipped:** non-conformances, CAPA, SOPs with training acknowledgement, the risk register, vendors and supplier scorecards.

Several states exist because collapsing them loses the question an auditor asks:

| State | Distinguishes |
|---|---|
| `CAPA_REQUIRED` vs `UNDER_INVESTIGATION` | "we know what went wrong" from "we fixed it" |
| CAPA `VERIFICATION` before `CLOSED` | someone did something from **it was effective** — which is what ISO 13485 asks |
| Vendor `CONDITIONAL` | a real qualification state; forcing it to APPROVED or REJECTED discards the condition, which is the whole content of the decision |

**`risks.rpn` and `supplier_scorecards.overallScore` are `VIRTUAL`** — derived, never stored (BR-12). A stored value can disagree with its own inputs after an edit, and there is then no way to tell which is right.

**SOPs are archived, never deleted.** A withdrawn procedure must still be producible, because work was done under it.

**⚠ Two defects.** `GET /qms/nc`, `/qms/capa` and `/sop` returned rows **inside `data`** rather than `data` plus a top-level `meta` — three frontend screens rendered **empty for weeks with no error anywhere**. And `PATCH /qms/nc/:id` with a bad enum **500ed** because there was no validator, so the value reached the database.

**A bad enum reaching the database is always a missing validator**, and it always surfaces as a 500 rather than a 400 — which sends the investigation to the wrong layer.

**⚠ A third defect, same shape as certificates.** Risks with no assignee were **completely invisible** — absent from lists, 404 on get, update and delete — because `getRisks` and `getRiskById` included optional associations without `required: false`, against a model with a `defaultScope`. Both became INNER JOINs.

---

### P5-06 — Workflow engine

| | |
|---|---|
| **Status** | ✅ DONE — **beyond the plan** |

**What shipped:** configurable approval chains over exactly three resource types — `Certificate`, `StockTransfer`, `MaintenanceWorkOrder`.

**The ENUM is a closed set on purpose.** A generic "any resource" engine would need a generic permission model, and the menu-group model is not generic.

Steps are gated by **role**, not by user — a step requiring a named person stops when that person is on leave.

**⚠ The defect.** `workflow.service` destructured `db` from the models barrel, which exports **`sequelize`**. `db.sequelize` was `undefined`, and **every workflow create, update and submit-action 500ed** until it was fixed in three places.

---

### P5-07 — Kanban and support desk

| | |
|---|---|
| **Status** | ✅ DONE — **entirely beyond scope** |

**Kanban:** nine tables, 28 endpoints, sprints, labels, card relations, and stable `cardKey` values so a card referenced in a commit message stays findable after it moves.

Only `kanban_projects` and `kanban_cards` carry `tenantId`; the rest inherit through `projectId`. **A query starting from a child table must join to the project** or it is unscoped.

**The socket gotcha:** the room join takes the **raw `projectId`**, not a prefixed room name. A prefixed string joins a room nobody publishes to, and the symptom is **silence**, not an error.

**Support desk:** two menu slugs, not one. `SUPERADMIN` holds `tickets-response` and deliberately **not** `tickets-raise` — the platform operator answers tickets and never raises them (BR-13). The response side is cross-tenant, because otherwise nobody could be answered.

`ticket_comments.isInternal` marks responder-only notes. A list query that forgets the flag shows internal notes to the raiser — a disclosure bug, and an easy one to write.

---

### P5-08 — Data lake

| | |
|---|---|
| **Status** | ❌ **NOT DONE — deliberately** |
| **Follow-up** | P8-04 |

**⚠ Divergence.** The plan called for a data lake. There is none, and there should not be one yet.

Reporting runs against the **operational database** with indexes chosen for it — `next_calibration_date`, `is_compliant`, `(device_id, timestamp)`, `published_at`.

That is a correct choice at current scale and a wrong one eventually. **The trigger is measured impact of reporting queries on operational p95** — not a threshold anyone guessed in advance. When it fires, the answer is a **read replica before it is a warehouse** (PR-10).

Building a warehouse now would be infrastructure to maintain, a second copy of the data to keep consistent, and a second place tenant isolation could leak — for a problem nobody has measured.

**That trigger cannot fire without measurement**, which is the strongest argument for P8-07.

---

## Phase 5 — Retrospective

**What shipped beyond plan:** the entire quality-management surface, the workflow engine, Kanban, the support desk, pgvector RAG, and an embedded MQTT broker.

**What did not ship, deliberately:** the data lake.

**What failed, and what it taught:**

| Failure | Lesson |
|---|---|
| QMS, CAPA and SOP lists rendered **empty for weeks** | the envelope is a contract; a client written against it breaks **silently** |
| A bad enum **500ed** instead of 400ing | that is always a missing validator |
| Risks with no assignee were **invisible** | `required: false` — the third occurrence of this shape |
| Every workflow write **500ed** | the models barrel exports `sequelize`, not `db` |

**What remains open:**

| | → |
|---|---|
| RAG retrieval is the **highest-risk isolation surface** | continuous review |
| No measurement of reporting impact on operational p95 | P8-07 |
| `iot_readings` and `audit_logs` unpartitioned | P8-05, P8-06 |

**What to watch:** any change to `document_chunks` retrieval. A missing tenant predicate there does not error, does not warn, and produces a fluent answer citing another hospital's documents.
