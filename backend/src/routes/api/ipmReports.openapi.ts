/**
 * The contract of `ipmReports.route.ts`, code-first (ADR-103): the public IPM report verification
 * and the "due" list (P21-04; ADR-126 Am. 2, Am. 5; P19-06 § 9, P19-02 § 11). Examples are synthetic.
 */
import { z } from "zod";
import { ipmDueQuery } from "@callibrator/contracts/inspectionSessions";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { IpmDueDevice, IpmVerification } from "../../docs/openapi/ipmSessionSchemas";

export default defineRouteDocs({
  router: "api/ipmReports.route",
  mount: "/api/v1/ipm",
  tag: "IPM Reports",
  tagDescription: "The IPM report's public verification and the devices whose IPM is due (ADR-126)",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/verify/:reportNumber",
      operationId: "verifyIpmReport",
      summary: "Publicly verify a printed IPM report (no auth)",
      description:
        "The target of the report's QR. The token (24 random bytes, base64url) is required: a malformed number or token, an unknown " +
        "token or a number that is not the token's report all answer the same 404 `No IPM report matches this link.`. The verdict " +
        "says issued, superseded (with the newer report's number, never its token) or voided (the date, never the reason), with the " +
        "signatures, the integrity and the data document to render. Per client address, every request counts against 300 per 15 " +
        "minutes and every answer that is not a verdict also against 60 per 15 minutes; beyond either, 429 with Retry-After.",
      permission: null,
      audited: false,
      params: z.object({ reportNumber: z.string().meta({ description: "The report number", example: "IPM-F-0001-20261008-003" }) }),
      query: z.object({
        token: z.string().optional().meta({ description: "The report's verification token (from its QR code)", example: "q3kZ0x9VbN2mP4rT6wY8aC1dE3fG5hJ7" }),
      }),
      success: { status: 200, description: "The verdict", data: IpmVerification },
    },
    {
      method: "get",
      path: "/due",
      operationId: "listIpmDue",
      summary: "Devices whose IPM is due",
      description:
        "`ipm` read. `state=due` (default): devices whose last effective IPM month + interval is this month or earlier in the tenant's " +
        "time zone, and scheduled devices never inspected; `never_inspected`; `all_scheduled`. The interval is the device's " +
        "`ipmIntervalMonths` (0 = not under IPM), else the tenant's `ipm_interval_months` (unset: nothing is scheduled). Retired and " +
        "inactive devices are never scheduled. Ordered by name, then id. A facility-bound account sees its facility's devices only. " +
        "P21-07: `month=YYYY-MM` sets the reference month (\"due by the end of that month\") instead of the current one — from the " +
        "current month to 24 months ahead in the tenant's zone, else 400 with the top-level code `IPM_DUE_MONTH_OUT_OF_RANGE`; " +
        "each row's `ipmDue` is computed for that month.",
      permission: { kind: "dynamicAccess", resource: "ipm", action: "read" },
      audited: false,
      query: ipmDueQuery,
      success: { status: 200, description: "A page of devices; pagination in the top-level `meta`", list: IpmDueDevice },
    },
  ],
});
