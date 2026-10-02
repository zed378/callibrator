/**
 * P10-05 (ADR-098 §6) — the contract of `accessRequests.route.ts`, code-first
 * (P9-25). The request body IS the schema `validate()` enforces.
 * Examples are synthetic — no real hospital, person or number.
 */
import { submitAccessRequestSchema } from "../../validators/accessRequest.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

export default defineRouteDocs({
  router: "api/accessRequests.route",
  mount: "/api/v1/access-requests",
  tag: "Access requests",
  tagDescription:
    "P10-05: a hospital or calibration lab asks for access; the platform's super admin approves (which creates the tenant) or rejects.",
  tenantScoped: false,
  operations: [
    {
      method: "post",
      path: "/",
      operationId: "submitAccessRequest",
      summary: "Request access (public)",
      description:
        "Public — no token. The answer is ALWAYS `202 Request received` with `data: null`: for a new request, a " +
        "duplicate, an address over its daily cap (3 per 24 h) and a filled honeypot (`website`) alike, so the " +
        "endpoint says nothing about who has asked before. Only a malformed field answers 400, about its shape. " +
        "`tenantId`, `status`, `decidedBy` and `provisionedTenantId` in the body are ignored (stripped). No email is " +
        "sent to the requester. Budget: 5 requests an hour per client address (ADR-100 `accessRequest`). " +
        "Absent until the deployment publishes its privacy notice (`PRIVACY_NOTICE_URL`, Q-42, ADR-113): until " +
        "then every request answers the standard not-found 404, whatever its body.",
      permission: null,
      audited: true,
      body: submitAccessRequestSchema,
      success: { status: 202, description: "Received (whatever happened to it)", empty: true },
    },
  ],
});
