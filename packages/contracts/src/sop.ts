/**
 * SOP document control: `/api/v1/sop`.
 *
 * W-10 (2026-10-05): the create body, enforced by `validate()` on `POST /`.
 * Before, the route carried no schema and `sop.service#createDocument` passed
 * whatever arrived to `SopDocument.create`: a body without a title (or a
 * bodyless request, which bodyDefault turns into `{}`) reached the model's
 * NOT NULL and answered **500** — a client mistake reported as a server
 * fault. So did `requiresTraining: null` (the column is NOT NULL as well).
 *
 * The fields are the ones the service reads; anything else is STRIPPED (the
 * parsed body replaces `req.body`), so a client cannot set the status, the
 * number, the author or the tenant. An empty or null `version` still reads as
 * "1.0" in the service, as before; the lengths are the columns'
 * (`title` and `content_url` STRING(255), `version` STRING(20)).
 */
import { z } from "zod";
import { booleanish, optionalText } from "./fields";

/** `POST /api/v1/sop` — a new DRAFT document. */
const createSopDocument = z.object({
  title: z.string().trim().min(1).max(255).meta({ example: "Calibration of infusion pumps" }),
  version: optionalText(20).meta({ description: "Defaults to 1.0 when absent, empty or null", example: "1.0" }),
  contentUrl: optionalText(255),
  requiresTraining: booleanish()
    .optional()
    .meta({ description: "Defaults to true: publishing then assigns training to the tenant's users" }),
});

export type CreateSopDocumentBody = z.output<typeof createSopDocument>;
export type CreateSopDocumentInput = z.input<typeof createSopDocument>;

export { createSopDocument };
