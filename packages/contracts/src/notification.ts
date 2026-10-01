/**
 * Notification request bodies.
 *
 * P9-11 (ADR-093): moved to Zod. The two messages the bulk-delete UI can show
 * are kept word for word.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/notification.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the notification routes.
 */
import { z } from "zod";
import { uuid } from "./fields";

// Bulk delete: an explicit, non-empty list of notification ids. Ids the caller
// cannot see are filtered out by the service's recipient scope, so this only
// guards the payload shape.
const deleteManySchema = z.object({
  ids: z
    .array(uuid(), { error: (issue) => (issue.input === undefined ? "ids is required" : undefined) })
    .min(1, { error: "Select at least one notification to delete" })
    .max(500),
});

export { deleteManySchema };

// The client-side (input) and handler-side (output) types of each schema.
export type DeleteManyInput = z.input<typeof deleteManySchema>;
export type DeleteManyBody = z.output<typeof deleteManySchema>;
