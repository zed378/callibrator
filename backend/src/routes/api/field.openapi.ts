/**
 * The contract of `field.route.ts`, code-first (ADR-103): the field app's administrator wipe
 * (P21-03c; P19-08 spec § 11.3, G-O9; ADR-135). Examples are synthetic.
 */
import { z } from "zod";
import { fieldWipe } from "@callibrator/contracts/inspectionSessions";
import { defineRouteDocs } from "../../docs/openapi/operation";

const FieldWipeRecord = z
  .object({ wipedUserId: z.guid(), captures: z.number().int(), photos: z.number().int(), recordedAt: z.iso.datetime() })
  .meta({
    id: "FieldWipeRecord",
    description: "A recorded wipe of another user's offline data on a phone — counts only",
    example: { wipedUserId: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2", captures: 2, photos: 5, recordedAt: "2026-10-09T03:00:00.000Z" },
  });

export default defineRouteDocs({
  router: "api/field.route",
  mount: "/api/v1/field",
  tag: "Field App",
  tagDescription: "The offline field app's server side (ADR-127)",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/wipes",
      operationId: "recordFieldWipe",
      summary: "Record a wipe of another user's offline data",
      description:
        "A tenant administrator (then `ipm` write) records that it is about to wipe another user's offline captures on a phone; the " +
        "app deletes only after this answer (ADR-135). The wiped user must be of the caller's tenant (else 404). One audit row " +
        "(`DELETE`, resource `User`, `FIELD_DATA_WIPED`, the counts). An API key is refused. Not available to a facility-bound " +
        "account (403 FACILITY_ROUTE_REFUSED).",
      permission: { kind: "rbac", roles: ["TENANT_ADMIN"] },
      audited: true,
      body: fieldWipe,
      success: { status: 201, description: "The wipe as recorded", data: FieldWipeRecord },
    },
  ],
});
