import { api } from "../client";

/**
 * P10-07 — the super admin's access-request queue, against
 * backend/src/routes/api/admin.route.js (`/api/v1/admin/access-requests`,
 * super admin only) and backend/src/services/accessRequest.service.ts.
 * Rows are in `data`; pagination and per-status counts in a TOP-LEVEL `meta`.
 */

export type AccessRequestStatus = "pending" | "approved" | "rejected" | "spam" | "expired";

export const ACCESS_REQUEST_STATUSES: readonly AccessRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "spam",
  "expired",
];

export interface AccessRequestRow {
  id: string;
  organisationName: string;
  facilityType: "hospital" | "clinic" | "calibration_lab" | "other";
  city: string;
  deviceCountBand: "lt_100" | "100_499" | "500_1999" | "gte_2000" | "unknown";
  contactName: string;
  contactRole: string | null;
  workEmail: string;
  whatsapp: string;
  needs: string | null;
  locale: "id" | "en";
  status: AccessRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  provisionedTenantId: string | null;
  duplicateCount: number;
}

export interface AccessRequestDetail extends AccessRequestRow {
  decisionNote: string | null;
  decidedBy: { id: string; name: string | null } | null;
  provisionedTenant: { id: string; code: string; name: string } | null;
  adminUserId: string | null;
  invitation: {
    sentAt: string | null;
    expiresAt: string | null;
    acceptedAt: string | null;
    resendable: boolean;
  };
  duplicates: { id: string; organisationName: string; status: AccessRequestStatus; createdAt: string }[];
}

export interface AccessRequestPage {
  rows: AccessRequestRow[];
  meta: {
    total: number;
    page: number;
    limit: number;
    counts: Record<AccessRequestStatus, number>;
  };
}

export interface ApproveInput {
  tenantCode: string;
  tenantName?: string;
  adminFirstName?: string;
  adminLastName?: string;
}

interface Envelope<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

const BASE = "/api/v1/admin/access-requests";

export const accessRequestService = {
  list: async (status: AccessRequestStatus, page = 1, limit = 20): Promise<AccessRequestPage> => {
    const res = await api.get<Envelope<AccessRequestRow[]> & { meta: AccessRequestPage["meta"] }>(BASE, {
      params: { status, page, limit },
    });
    return { rows: res.data ?? [], meta: res.meta };
  },

  get: async (id: string): Promise<AccessRequestDetail> =>
    (await api.get<Envelope<AccessRequestDetail>>(`${BASE}/${id}`)).data,

  approve: async (
    id: string,
    input: ApproveInput,
  ): Promise<{ invitationSent: boolean; tenant: { id: string; code: string; name: string } }> =>
    (await api.post<Envelope<{ invitationSent: boolean; tenant: { id: string; code: string; name: string } }>>(
      `${BASE}/${id}/approve`,
      input,
    )).data,

  reject: async (id: string, reason: string, spam: boolean): Promise<AccessRequestRow> =>
    (await api.post<Envelope<AccessRequestRow>>(`${BASE}/${id}/reject`, { reason, spam })).data,

  resendInvitation: async (id: string): Promise<{ invitationSent: boolean; expiresAt: string }> =>
    (await api.post<Envelope<{ invitationSent: boolean; expiresAt: string }>>(`${BASE}/${id}/resend-invitation`, {}))
      .data,
};

/** A tenant code suggested from an organisation name: upper-case letters and digits, at most 12. */
export const suggestTenantCode = (name: string): string => {
  const words = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const initials = words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join("");
  const code = (initials.length >= 3 ? initials : words.join("")).toUpperCase();
  return code.slice(0, 12);
};
