import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";

/**
 * P10-07 — the super admin's access-request queue, against
 * backend/src/routes/api/admin.route.ts (`/api/v1/admin/access-requests`,
 * super admin only) and backend/src/services/accessRequest.service.ts.
 * Rows are in `data`; pagination and per-status counts in a TOP-LEVEL `meta`.
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; every type is the contract's
 * (backend/src/routes/api/admin.openapi.ts). The exported names are unchanged.
 */

export type AccessRequestRow = components["schemas"]["AccessRequestQueueRow"];
export type AccessRequestStatus = AccessRequestRow["status"];

export const ACCESS_REQUEST_STATUSES: readonly AccessRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "spam",
  "expired",
];

type ById = "/api/v1/admin/access-requests/{id}";

export type AccessRequestDetail = DataOf<Op<ById, "get">>;

export interface AccessRequestPage {
  rows: AccessRequestRow[];
  meta: Answer["meta"];
}
type Answer = Awaited<ReturnType<typeof listAnswer>>;

export type ApproveInput = JsonBody<Op<`${ById}/approve`, "post">>;
export type ApproveResult = DataOf<Op<`${ById}/approve`, "post">>;

const byId = (id: string) => ({ params: { path: { id } } });

const listAnswer = (status: AccessRequestStatus, page: number, limit: number) =>
  typedApi.GET("/api/v1/admin/access-requests", { params: { query: { status, page, limit } } }).then(unwrap);

export const accessRequestService = {
  list: async (status: AccessRequestStatus, page = 1, limit = 20): Promise<AccessRequestPage> => {
    const res = await listAnswer(status, page, limit);
    return { rows: res.data ?? [], meta: res.meta };
  },

  get: async (id: string): Promise<AccessRequestDetail> =>
    (await typedApi.GET("/api/v1/admin/access-requests/{id}", byId(id)).then(unwrap)).data,

  approve: async (id: string, input: ApproveInput): Promise<ApproveResult> =>
    (await typedApi.POST("/api/v1/admin/access-requests/{id}/approve", { ...byId(id), body: input }).then(unwrap)).data,

  reject: async (id: string, reason: string, spam: boolean): Promise<AccessRequestRow> =>
    (
      await typedApi
        .POST("/api/v1/admin/access-requests/{id}/reject", { ...byId(id), body: { reason, spam } })
        .then(unwrap)
    ).data,

  resendInvitation: async (id: string): Promise<DataOf<Op<`${ById}/resend-invitation`, "post">>> =>
    (
      await typedApi
        .POST("/api/v1/admin/access-requests/{id}/resend-invitation", {
          ...byId(id),
          // As built: an empty JSON object, though the contract reads no body.
          body: {} as never,
        })
        .then(unwrap)
    ).data,
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
