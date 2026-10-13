/**
 * The contract of `publicDevices.route.ts`, code-first (ADR-103): the public device page (P21-08;
 * ADR-138, Am. 1; spec MEMORY/specs/P19-07-public-device-page.md § 7 – § 8). Examples are synthetic.
 */
import { z } from "zod";
import { publicDeviceView } from "@callibrator/contracts/publicDevices";
import { defineRouteDocs } from "../../docs/openapi/operation";

export default defineRouteDocs({
  router: "api/publicDevices.route",
  mount: "/api/v1/public/devices",
  tag: "Public Device Page",
  tagDescription: "The page a device's sticker opens, by its revocable capability token (ADR-138)",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/:token",
      operationId: "readPublicDevice",
      summary: "The public page of a device, by its sticker's token (no auth)",
      description:
        "The target of a sticker's link. Shows the device's name, type, manufacturer and model, its facility's name, the calibration status " +
        "(`current`, `due_soon`, `overdue`, `retired`, `not_scheduled`) with the next due date, and the last IPM date; under the tenant's " +
        "`minimal_with_report` setting also the link to the last IPM report's verification page. Never a serial or QR number, a room, a photo, " +
        "a document, a person's name or an id. A malformed, unknown or revoked token, a deleted device, an ended facility, a suspended or deleted " +
        "tenant, or a tenant whose page is off all answer the same 404 with the top-level code `PUBLIC_DEVICE_NOT_FOUND`. Every answer carries " +
        "`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`. Per client address every request counts " +
        "against 120 per 15 minutes and every 404 also against 30; all addresses together against 3,000; beyond any, 429 with Retry-After.",
      permission: null,
      audited: false,
      params: z.object({ token: z.string().meta({ description: "The sticker's token (22 base64url characters)", example: "Zx3kQ9vN2mP4rT6wY8aC1d" }) }),
      success: { status: 200, description: "The page's data", data: publicDeviceView },
    },
  ],
});
