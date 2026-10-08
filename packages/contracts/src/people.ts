/**
 * P21-09e — how a person is shown beside a record (spec MEMORY/specs/P19-04-client-facilities.md
 * § 12; ADR-124 Am. 2 § 9; FT-15, FT-16; G-24).
 *
 * Provider staff have no facility, so for a facility-BOUND viewer every raw `User` include of a
 * provider author reads as null (the hooks). The responses therefore carry an additive `…Display`
 * field beside each person reference — `performerDisplay`, `calibratedByDisplay`,
 * `approvedByDisplay`, `signedByDisplay`, `assigneeDisplay`, `uploaderDisplay` — of this shape:
 * a name, a role, an organisation, and whether it was redacted. Never an id, an e-mail, a phone or a
 * username. A person bound to ANOTHER facility than a bound viewer (history moved in by a device
 * move) is redacted: `{ name: null, role, organisation: null, redacted: true }`.
 */
import { z } from "zod";

/** The exact keys of a person display — a test holds the backend's output to them (FT-15). */
export const PERSON_DISPLAY_KEYS = Object.freeze(["name", "role", "organisation", "redacted"] as const);

export const personDisplay = z.strictObject({
  name: z.string().nullable(),
  role: z.string().nullable(),
  organisation: z.string().nullable(),
  redacted: z.boolean(),
});
export type PersonDisplay = z.output<typeof personDisplay>;

/** The name shown for an author outside the tenant (the platform operator acting inside it, A-90 / Q-17). */
export const PLATFORM_SUPPORT_NAME = "Platform support";
