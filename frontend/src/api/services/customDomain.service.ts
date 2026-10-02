import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";

/**
 * Custom domains and vanity subdomains.
 *
 * The tenant comes from the caller's JWT.
 * Backend: src/routes/api/customDomains.route.ts (mounted /api/v1/custom-domains)
 *   GET    /domains
 *   POST   /domains
 *   POST   /domains/:domainId/verify
 *   POST   /domains/:domainId/default
 *   GET    /domains/:domainId/status
 *   GET    /domains/:domainId/dns
 *   DELETE /domains/:domainId
 *
 * There is no per-id GET and no update route — a domain is added and removed,
 * not edited. GET /domains returns a plain array in `data` (no meta, no rows).
 */

// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/customDomains.openapi.ts). The names are unchanged.

type D = "/api/v1/custom-domains/domains";
type ById = `${D}/{domainId}`;

// ---------- Types ----------

export type CustomDomain = components["schemas"]["CustomDomain"];
export type DomainType = CustomDomain["domainType"];

type DnsRecords = components["schemas"]["CustomDomainDnsRecords"];
/** A record to publish. `ttl` is never sent (the TTL line of the DNS panel never shows). */
export type DnsRecord = (DnsRecords["verification"] | DnsRecords["cname"]) & { ttl?: number };

export type DomainStatusResult = DataOf<Op<`${ById}/status`, "get">>;

/**
 * POST /domains/:id/verify's `data` (customDomains.service verifyDomain):
 * `{ verified, status, record, dnsRecord }` after a DNS lookup, or
 * `{ verified: false, reason }` when custom domains are switched off. A 200
 * does not mean verified — `verified` does. Either answer, read flat: a field
 * the answer lacks reads undefined.
 */
export interface VerifyResult {
  verified?: boolean;
  status?: string;
  /** Why nothing was checked (custom domains disabled). */
  reason?: string;
  /** The token that matched, or null. */
  record?: string | null;
  dnsRecord?: { type?: string; name?: string; value?: string };
}

/** `domain` must be a valid hostname; the server defaults `type` to "subdomain" and `sslEnabled` to true. */
export type DomainCreateInput = JsonBody<Op<D, "post">>;

const domain = (domainId: string) => ({ params: { path: { domainId } } });

// ---------- Service ----------

export const customDomainService = {
  /** GET /domains — data is a plain array. */
  getAll: async (): Promise<CustomDomain[]> => {
    const response = await typedApi.GET("/api/v1/custom-domains/domains").then(unwrap);
    return response.data ?? [];
  },

  /** POST /domains — returns 201. */
  create: async (input: DomainCreateInput): Promise<DataOf<Op<D, "post">>> =>
    (await typedApi.POST("/api/v1/custom-domains/domains", { body: input }).then(unwrap)).data,

  /** POST /domains/:domainId/verify — id in the path, no body. */
  verify: async (domainId: string): Promise<VerifyResult> =>
    (await typedApi.POST("/api/v1/custom-domains/domains/{domainId}/verify", domain(domainId)).then(unwrap)).data,

  /** POST /domains/:domainId/default — POST, not PATCH. */
  setAsDefault: async (domainId: string): Promise<DataOf<Op<`${ById}/default`, "post">>> =>
    (await typedApi.POST("/api/v1/custom-domains/domains/{domainId}/default", domain(domainId)).then(unwrap)).data,

  /** GET /domains/:domainId/status */
  getStatus: async (domainId: string): Promise<DomainStatusResult> =>
    (await typedApi.GET("/api/v1/custom-domains/domains/{domainId}/status", domain(domainId)).then(unwrap)).data,

  /** GET /domains/:domainId/dns — the records to add at your DNS provider. */
  getDnsRecords: async (domainId: string): Promise<DnsRecord[]> => {
    // The backend answers an object — { verification: TXT, cname: CNAME,
    // instructions } (customDomains.service getDnsVerificationInstructions) —
    // not a list; the screen's `.map` over it threw. Read the two records out
    // of it; a list is still accepted.
    const response = await typedApi
      .GET("/api/v1/custom-domains/domains/{domainId}/dns", domain(domainId))
      .then(unwrap);
    const data: DnsRecord[] | Partial<DnsRecords> | null = response.data;
    if (Array.isArray(data)) return data;
    return [data?.verification, data?.cname].filter((r): r is DnsRecord => Boolean(r));
  },

  /** DELETE /domains/:domainId */
  delete: async (domainId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/custom-domains/domains/{domainId}", domain(domainId));
  },
};

export default customDomainService;
