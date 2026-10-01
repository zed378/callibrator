import { api } from "../client";

/**
 * Custom domains and vanity subdomains.
 *
 * The tenant comes from the caller's JWT.
 * Backend: src/routes/api/customDomains.route.js (mounted /api/v1/custom-domains)
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

const BASE = "/api/v1/custom-domains";

// ---------- Types ----------

export type DomainType = "subdomain" | "custom" | "vanity";

export interface CustomDomain {
  id: string;
  domain: string;
  type: DomainType;
  sslEnabled?: boolean;
  isDefault?: boolean;
  status?: string;
  verifiedAt?: string | null;
  createdAt?: string;
}

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl?: number;
}

export interface DomainStatusResult {
  status?: string;
  verified?: boolean;
  sslEnabled?: boolean;
  checkedAt?: string;
}

/**
 * POST /domains/:id/verify's `data` (customDomains.service verifyDomain):
 * `{ verified, status, record, dnsRecord }` after a DNS lookup, or
 * `{ verified: false, reason }` when custom domains are switched off. A 200
 * does not mean verified — `verified` does.
 */
export interface VerifyResult {
  verified?: boolean;
  status?: string;
  /** Why nothing was checked (custom domains disabled). */
  reason?: string;
  /** The token that matched, or null. */
  record?: string | null;
  dnsRecord?: { type?: string; name?: string; value?: string };
  message?: string;
}

export interface DomainCreateInput {
  /** Must be a valid hostname. */
  domain: string;
  /** Server defaults to "subdomain". */
  type?: DomainType;
  /** Server defaults to true. */
  sslEnabled?: boolean;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const customDomainService = {
  /** GET /domains — data is a plain array. */
  getAll: async (): Promise<CustomDomain[]> => {
    const response = await api.get<BackendResponse<CustomDomain[]>>(
      `${BASE}/domains`,
    );
    return response.data ?? [];
  },

  /** POST /domains — returns 201. */
  create: async (input: DomainCreateInput): Promise<CustomDomain> => {
    const response = await api.post<BackendResponse<CustomDomain>>(
      `${BASE}/domains`,
      input,
    );
    return response.data;
  },

  /** POST /domains/:domainId/verify — id in the path, no body. */
  verify: async (domainId: string): Promise<VerifyResult> => {
    const response = await api.post<BackendResponse<VerifyResult>>(
      `${BASE}/domains/${domainId}/verify`,
    );
    return response.data;
  },

  /** POST /domains/:domainId/default — POST, not PATCH. */
  setAsDefault: async (domainId: string): Promise<CustomDomain> => {
    const response = await api.post<BackendResponse<CustomDomain>>(
      `${BASE}/domains/${domainId}/default`,
    );
    return response.data;
  },

  /** GET /domains/:domainId/status */
  getStatus: async (domainId: string): Promise<DomainStatusResult> => {
    const response = await api.get<BackendResponse<DomainStatusResult>>(
      `${BASE}/domains/${domainId}/status`,
    );
    return response.data;
  },

  /** GET /domains/:domainId/dns — the records to add at your DNS provider. */
  getDnsRecords: async (domainId: string): Promise<DnsRecord[]> => {
    // The backend answers an object — { verification: TXT, cname: CNAME,
    // instructions } (customDomains.service getDnsVerificationInstructions) —
    // not a list; the screen's `.map` over it threw. Read the two records out
    // of it; a list is still accepted.
    const response = await api.get<
      BackendResponse<DnsRecord[] | { verification?: DnsRecord; cname?: DnsRecord } | null>
    >(`${BASE}/domains/${domainId}/dns`);
    const data = response.data;
    if (Array.isArray(data)) return data;
    return [data?.verification, data?.cname].filter((r): r is DnsRecord => Boolean(r));
  },

  /** DELETE /domains/:domainId */
  delete: async (domainId: string): Promise<void> => {
    await api.delete<BackendResponse<null>>(`${BASE}/domains/${domainId}`);
  },
};

export default customDomainService;
