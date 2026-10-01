/**
 * Custom Domains Validators.
 *
 * P9-11 (ADR-093): moved to Zod. The two messages the domain form shows are kept
 * word for word; the file's `validate` helper, which nothing called, is gone
 * (`validators/input` is the one helper).
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/customDomains.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the customDomains routes.
 */
import { z } from "zod";
import { booleanish } from "./fields";

const DOMAIN_TYPES = ["subdomain", "custom", "vanity"] as const;

/** Validate domain addition. */
const addDomain = z.object({
  // A domain name whose last label starts with a letter, or an IP address, as
  // before P9-11. Zod's hostname alone also accepts "123" or "2026-09-29".
  domain: z.union([z.ipv4(), z.ipv6(), z.hostname().refine((host) => /(?:^|\.)[a-z][a-z0-9-]*$/i.test(host))], {
    error: (issue) => (issue.input === undefined ? "Domain is required" : "Must be a valid hostname"),
  }),
  type: z.enum(DOMAIN_TYPES).default("subdomain"),
  sslEnabled: booleanish().default(true),
});

/** Validate domain type. */
const domainType = z.object({
  type: z.enum(DOMAIN_TYPES),
});

export { addDomain, domainType };

// The client-side (input) and handler-side (output) types of each schema.
export type AddDomainInput = z.input<typeof addDomain>;
export type AddDomainBody = z.output<typeof addDomain>;
export type DomainTypeInput = z.input<typeof domainType>;
export type DomainTypeBody = z.output<typeof domainType>;
