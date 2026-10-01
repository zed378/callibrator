/**
 * SCIM 2.0 request bodies. The SCIM routes mount no body middleware; the
 * controller checks the body with `validateInput` (validators/input).
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/scim.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the scim routes.
 */
import { z } from "zod";
import { booleanish, email, uuid } from "./fields";

const scimUserSchema = z.object({
  userName: email(),
  name: z
    .object({
      givenName: z.string().min(1).optional(),
      familyName: z.string().min(1).optional(),
    })
    .optional(),
  emails: z
    .array(
      z.object({
        value: email(),
        type: z.string().min(1).optional(),
        primary: booleanish().optional(),
      }),
    )
    .optional(),
  active: booleanish().optional(),
  // roleId is accepted but constrained in the service: SCIM may never assign
  // SUPERADMIN or any system role (A-27).
  roleId: uuid().optional(),
});

const scimGroupSchema = z.object({
  // scim_groups.display_name is VARCHAR(255) (ADR-053).
  displayName: z.string().min(1).max(255),
  // The role this tenant's group grants (ADR-053, A-39). Optional: standard
  // IdPs send only displayName and members; an unmapped group grants nothing
  // and refuses members until it is mapped. The service checks the role.
  roleId: uuid().optional(),
  members: z
    .array(
      z.object({
        value: uuid(),
        display: z.string().min(1).optional(),
      }),
    )
    .optional(),
});

const scimPatchSchema = z.object({
  Operations: z.array(
    z.object({
      op: z.enum(["add", "remove", "replace"]),
      // RFC 7644 § 3.5.2: an attribute path string, e.g. "active",
      // "name.givenName" or `members[value eq "<id>"]`. The service resolves it;
      // an unparseable path is a 400, never a silent no-op (A-33).
      path: z.string().min(1).optional(),
      // `{ "op": "replace", "path": "active", "value": false }` is the form Okta,
      // Entra ID and OneLogin send to deactivate a user (A-33).
      value: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()), z.string(), z.boolean(), z.number()]).optional(),
    }),
  ),
});

export { scimUserSchema, scimGroupSchema, scimPatchSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type ScimUserInput = z.input<typeof scimUserSchema>;
export type ScimUserBody = z.output<typeof scimUserSchema>;
export type ScimGroupInput = z.input<typeof scimGroupSchema>;
export type ScimGroupBody = z.output<typeof scimGroupSchema>;
export type ScimPatchInput = z.input<typeof scimPatchSchema>;
export type ScimPatchBody = z.output<typeof scimPatchSchema>;
