/**
 * P9-21 / P9-25 (ADR-103) — the contract of `customDomains.route.ts`, code-first.
 * Its `@swagger` JSDoc was deleted when this file was written. That JSDoc
 * documented a `vanitySubdomain` body field the validator strips, omitted the
 * `type` and `sslEnabled` it accepts (P6-08 KNOWN_DRIFT), and listed statuses
 * (`pending`, `verified`, `failed`) the model does not have.
 *
 * The request body is the object `validate()` enforces (`addDomain`, from
 * `@callibrator/contracts/customDomains`). The response schemas describe what
 * customDomains.service answers (the CustomDomain model row as JSON, or the
 * service's own objects). Examples are synthetic (RFC 2606 names).
 */
import { z } from "zod";
import { addDomain } from "../../validators/customDomains.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

/** `validateUuid` checks the 8-4-4-4-12 SHAPE, not an RFC version: `z.guid()`. */
const params = z.object({
  domainId: z.guid().meta({ description: "The custom domain record's id", example: "5f0c2a8e-7c1d-4b6a-9e2f-3d4c5b6a7e81" }),
});

const DOMAIN_STATUSES = ["pending_verification", "active", "verification_failed", "deleting", "deleted"] as const;

const domainRow = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    domain: z.string().meta({ example: "app.hospital.example" }),
    domainType: z.enum(["custom", "subdomain", "vanity"]),
    status: z.enum(DOMAIN_STATUSES),
    isDefault: z.boolean(),
    sslEnabled: z.boolean(),
    verificationToken: z.string().nullable(),
    verifiedAt: z.iso.datetime().nullable(),
    lastCheckedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "CustomDomain", description: "A tenant's custom domain (the model row)" });

const dnsInstructions = z
  .object({
    verification: z.object({
      type: z.literal("TXT"),
      name: z.string().meta({ example: "_domain_verify.app.hospital.example" }),
      value: z.string().meta({ example: "callibrator-verify=0123456789abcdef0123456789abcdef" }),
    }),
    cname: z.object({
      type: z.literal("CNAME"),
      name: z.string().meta({ example: "app.hospital.example" }),
      value: z.string().meta({ example: "cname.callibrator.io." }),
    }),
    instructions: z.array(z.string()),
  })
  .meta({ id: "CustomDomainDnsRecords", description: "The DNS records the tenant must publish" });

const read = { kind: "dynamicAccess", resource: "custom-domains", action: "read" } as const;
const write = { kind: "dynamicAccess", resource: "custom-domains", action: "write" } as const;

export default defineRouteDocs({
  router: "api/customDomains.route",
  mount: "/api/v1/custom-domains",
  tag: "CustomDomains",
  tagDescription:
    "A tenant's custom domains and their DNS ownership check. A verified domain is a verified CLAIM: nothing yet serves the application on it (A-256).",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/domains",
      operationId: "listCustomDomains",
      summary: "List custom domains",
      description: "The caller's tenant's domains that are not deleted, newest first. A failed read answers an empty list.",
      permission: read,
      audited: false,
      success: { status: 200, description: "The tenant's domains (not paginated: no `meta`)", data: z.array(domainRow) },
    },
    {
      method: "post",
      path: "/domains",
      operationId: "addCustomDomain",
      summary: "Add a custom domain",
      description:
        "Adds a domain pending verification and emails the DNS records to the requester and the tenant's administrators. " +
        "The domain is stored lower-case. API keys are refused.",
      permission: write,
      audited: true,
      body: addDomain,
      success: {
        status: 201,
        description: "The added domain and the records to publish",
        data: z.object({
          id: z.guid(),
          domain: z.string(),
          status: z.literal("pending_verification"),
          sslEnabled: z.boolean(),
          verification: dnsInstructions,
        }),
      },
      conflict: "The domain is already registered for this tenant, or another organisation holds it verified.",
      errors: [400],
    },
    {
      method: "post",
      path: "/domains/:domainId/verify",
      operationId: "verifyCustomDomain",
      summary: "Verify a custom domain",
      description:
        "Resolves `_domain_verify.<domain>` and looks for the token. Both outcomes are a 200: the domain becomes `active` or " +
        "`verification_failed`. With custom domains disabled the answer is `{ verified: false, reason }`. API keys are refused.",
      permission: write,
      audited: true,
      params,
      success: {
        status: 200,
        description: "The verification outcome",
        data: z.union([
          z.object({
            verified: z.boolean(),
            status: z.enum(DOMAIN_STATUSES),
            record: z.string().nullable(),
            dnsRecord: z.object({ type: z.literal("TXT"), name: z.string(), value: z.string() }),
          }),
          z.object({ verified: z.literal(false), reason: z.string() }),
        ]),
      },
      conflict: "The domain was removed, or another organisation holds it verified.",
    },
    {
      method: "delete",
      path: "/domains/:domainId",
      operationId: "removeCustomDomain",
      summary: "Remove a custom domain",
      description: "Soft delete: the record is kept with status `deleted`. API keys are refused.",
      permission: write,
      audited: true,
      params,
      success: { status: 200, description: "The domain was removed", empty: true },
    },
    {
      method: "get",
      path: "/domains/:domainId/status",
      operationId: "getCustomDomainStatus",
      summary: "Get a custom domain's status",
      permission: read,
      audited: false,
      params,
      success: {
        status: 200,
        description: "The domain's status",
        data: z.object({
          id: z.guid(),
          domain: z.string(),
          status: z.enum(DOMAIN_STATUSES),
          sslEnabled: z.boolean(),
          isDefault: z.boolean(),
          verifiedAt: z.iso.datetime().nullable(),
          lastCheckedAt: z.iso.datetime().nullable(),
        }),
      },
    },
    {
      method: "post",
      path: "/domains/:domainId/default",
      operationId: "setDefaultCustomDomain",
      summary: "Make a custom domain the default",
      description: "Clears the flag on the tenant's other domains. API keys are refused.",
      permission: write,
      audited: true,
      params,
      success: {
        status: 200,
        description: "The new default",
        data: z.object({ id: z.guid(), domain: z.string(), isDefault: z.literal(true) }),
      },
      errors: [400],
    },
    {
      method: "get",
      path: "/domains/:domainId/dns",
      operationId: "getCustomDomainDnsRecords",
      summary: "Get a custom domain's DNS records",
      permission: read,
      audited: false,
      params,
      success: { status: 200, description: "The records to publish", data: dnsInstructions },
    },
  ],
});
