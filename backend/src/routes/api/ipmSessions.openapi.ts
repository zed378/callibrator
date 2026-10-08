/**
 * The contract of `ipmSessions.route.ts`, code-first (ADR-103): IPM session drafts — create,
 * header, results, discard, corrections — and the reads (P21-03; ADR-126; spec
 * MEMORY/specs/P19-02-ipm-session-aggregate.md § 7, § 9, § 10). Examples are synthetic.
 */
import { z } from "zod";
import {
  ipmResultsReplaceBody,
  ipmSessionCorrectionBody,
  ipmSessionCreate,
  ipmSessionDiscardBody,
  ipmSessionHeaderUpdateBody,
  ipmSessionIdParams,
  ipmSessionListQuery,
} from "@callibrator/contracts/inspectionSessions";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { IpmSession, IpmSessionSummary } from "../../docs/openapi/ipmSessionSchemas";

const params = z.object({
  sessionId: ipmSessionIdParams.shape.sessionId.meta({ description: "The IPM session's id", example: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1" }),
});
const read = { kind: "dynamicAccess", resource: "ipm", action: "read" } as const;
const write = { kind: "dynamicAccess", resource: "ipm", action: "write" } as const;

const WRITER =
  "`ipm` write; an API key is refused (an IPM is a person's record) and so is the platform operator (ADR-052). Audited inside the " +
  "transaction. Reachable by a facility-bound HEALTHCARE TECHNICIAN in its own facility.";
const IDEMPOTENT =
  "Honours an `Idempotency-Key` header (a UUID v4): a repeat of a completed request answers the stored status with the session " +
  "re-read now; a different body under the key → 409 `IDEMPOTENCY_KEY_REUSED`; a changed access → 409 `IDEMPOTENCY_SCOPE_CHANGED`; " +
  "a request still in flight → 409 `IDEMPOTENCY_IN_FLIGHT`. A failed request frees its key.";
const OWN_DRAFT =
  "Only the draft's creator (another user in scope: 403). Every 409 carries a top-level `code`: `IPM_NOT_DRAFT` (submitted, voided " +
  "or discarded — the message says when and what to do instead), `IPM_REVISION_CONFLICT` (another save came first: reload).";

export default defineRouteDocs({
  router: "api/ipmSessions.route",
  mount: "/api/v1/ipm/sessions",
  tag: "IPM Sessions",
  tagDescription: "Inspection and preventive maintenance sessions: drafts, corrections and their history (ADR-126)",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listIpmSessions",
      summary: "List IPM sessions",
      description:
        "`ipm` read. Default: submitted and voided sessions and the caller's own drafts (`status` narrows; `discarded` only on " +
        "request); `effective=true` keeps submitted sessions not superseded. Newest first, ending in `id`. A facility-bound account " +
        "sees its facility's sessions only (a foreign `clientFacilityId` answers an empty page).",
      permission: read,
      audited: false,
      query: ipmSessionListQuery,
      success: { status: 200, description: "A page of sessions; pagination in the top-level `meta`", list: IpmSessionSummary },
    },
    {
      method: "post",
      path: "/",
      operationId: "createIpmSession",
      summary: "Start an IPM draft for a device",
      description:
        "Pins a checklist version: the one sent (a retired one only when `capturedOffline`), else the device's current one. The " +
        "device is read in the caller's context (another tenant's or facility's is the 404). A `clientRef` the caller already used " +
        `answers **200** with that session (an offline replay). ${WRITER} ${IDEMPOTENT}`,
      permission: write,
      audited: true,
      body: ipmSessionCreate,
      conflict:
        "Top-level `code`: `IPM_DEVICE_RETIRED`, `IPM_DEVICE_INACTIVE`, `IPM_FACILITY_ENDED`, `IPM_VERSION_RETIRED`, `IPM_VERSION_STALE`, " +
        "`IPM_NO_CHECKLIST`, `IPM_DRAFT_EXISTS` (with the caller's own `draftId`), `IPM_CLIENT_REF_REUSED`; or an idempotency code.",
      success: { status: 201, description: "The draft (200 when the `clientRef` was already recorded)", data: IpmSession },
    },
    {
      method: "get",
      path: "/:sessionId",
      operationId: "getIpmSession",
      summary: "One IPM session with its results",
      description: "`ipm` read. Header, results in read order, the pinned version's hash, the device prefill, the performer display.",
      permission: read,
      audited: false,
      params,
      success: { status: 200, description: "The session", data: IpmSession },
    },
    {
      method: "patch",
      path: "/:sessionId",
      operationId: "updateIpmSessionHeader",
      summary: "Edit a draft's header",
      description: `The date, the confirmed room (a room of the device's facility, else 400), the outcomes, the recommendation and the notes. ${OWN_DRAFT} ${WRITER} ${IDEMPOTENT}`,
      permission: write,
      audited: true,
      params,
      body: ipmSessionHeaderUpdateBody,
      conflict: "`IPM_NOT_DRAFT`, `IPM_REVISION_CONFLICT`, or an idempotency code.",
      success: { status: 200, description: "The draft", data: IpmSession },
    },
    {
      method: "put",
      path: "/:sessionId/results",
      operationId: "replaceIpmSessionResults",
      summary: "Replace a draft's results",
      description:
        "Each row names a pinned template item (or an ad-hoc row of a section that takes them) and is checked against the server's " +
        "copy of the item: readings are decimals (`0,7` allowed, grouping refused) inside the possible range; a measured-with-limit " +
        `outcome is computed from the limit and cannot be overridden (400 names the item). ${OWN_DRAFT} ${WRITER} ${IDEMPOTENT}`,
      permission: write,
      audited: true,
      params,
      body: ipmResultsReplaceBody,
      conflict: "`IPM_NOT_DRAFT`, `IPM_REVISION_CONFLICT`, `IPM_FACILITY_ENDED`, or an idempotency code.",
      success: { status: 200, description: "The draft", data: IpmSession },
    },
    {
      method: "post",
      path: "/:sessionId/discard",
      operationId: "discardIpmSession",
      summary: "Discard a draft",
      description: `By its creator, or a tenant administrator who is not facility-bound (anyone else: 403). The row is kept; discarded is final. ${WRITER} ${IDEMPOTENT}`,
      permission: write,
      audited: true,
      params,
      body: ipmSessionDiscardBody,
      conflict: "`IPM_NOT_DRAFT` (only a draft can be discarded), or an idempotency code.",
      success: { status: 200, description: "The discarded draft", data: IpmSession },
    },
    {
      method: "post",
      path: "/:sessionId/corrections",
      operationId: "correctIpmSession",
      summary: "Start a correction of a submitted IPM",
      description:
        "A new draft that supersedes the session once submitted, with its header and results copied. A `clientRef` the caller " +
        `already used answers **200** with that session. ${WRITER} ${IDEMPOTENT}`,
      permission: write,
      audited: true,
      params,
      body: ipmSessionCorrectionBody,
      conflict:
        "`IPM_NOT_SUBMITTED`, `IPM_VOIDED` (a void is final), `IPM_SUPERSEDED` (with the chain's `headId`), `IPM_CORRECTION_OPEN`, " +
        "`IPM_FACILITY_ENDED`, `IPM_NO_CHECKLIST`, `IPM_CLIENT_REF_REUSED`, or an idempotency code.",
      success: { status: 201, description: "The correction draft (200 when the `clientRef` was already recorded)", data: IpmSession },
    },
  ],
});
