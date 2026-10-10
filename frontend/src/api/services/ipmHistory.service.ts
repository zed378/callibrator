import { typedApi, unwrap, type JsonBody, type Op, type QueryOf, type components } from "../typed";

/**
 * P22-04 — the IPM history (`dashboard/ipm`; F-54 … F-57; P19-02 spec § 7, § 10 as built by P21-03
 * and P21-04, ADR-126 Am. 4, Am. 5). Every call is on the GENERATED client:
 *
 *  - `GET /ipm/sessions` — the history list (`deviceId`, `status`, `effective`, `recommendation`,
 *    `from`/`to` on `performedAt`, `q` = device name or QR, `clientFacilityId` for provider staff);
 *    rows in `data`, paging in the TOP-LEVEL `meta`. By default: the caller's own drafts, every
 *    submitted and voided session; `discarded` only when asked.
 *  - `GET /ipm/sessions/:id` — one session with its results, lineage and side effects.
 *  - `POST …/corrections { reason }` — a correction DRAFT of the effective session (the original
 *    stays readable; it is superseded only when the correction is submitted).
 *  - `PATCH …/:id { revision, … }` — a draft's header (a date change is a correction).
 *  - `POST …/submit { revision }`, `POST …/discard { reason? }` — the draft's end.
 *  - `POST …/void { reason }` — final; an unbound tenant administrator only (the server decides).
 *
 * Every conflict is a 409 with a top-level `code` and the server's explanation, which the page
 * shows as written.
 */

type S = components["schemas"];
type ById = "/api/v1/ipm/sessions/{sessionId}";

export type IpmSession = S["IpmSession"];
export type IpmSessionSummary = S["IpmSessionSummary"];
export type IpmResult = S["IpmResult"];
export type IpmSessionListQuery = QueryOf<Op<"/api/v1/ipm/sessions", "get">>;
export type IpmHeaderBody = JsonBody<Op<ById, "patch">>;
export type PageMeta = S["PaginationMeta"];

/** One page of a list: the rows, and the paging the envelope carried beside them. */
export interface Paged<T> {
  rows: T[];
  meta: PageMeta;
}

const path = (sessionId: string) => ({ params: { path: { sessionId } } });

export const ipmHistoryService = {
  /** One page of the history. */
  list: async (query: IpmSessionListQuery): Promise<Paged<IpmSessionSummary>> => {
    const answer = await typedApi.GET("/api/v1/ipm/sessions", { params: { query } }).then(unwrap);
    const rows = answer.data ?? [];
    return { rows, meta: answer.meta ?? { total: rows.length, page: query.page ?? 1, limit: rows.length, totalPages: 1 } };
  },

  get: async (sessionId: string): Promise<IpmSession> => (await typedApi.GET("/api/v1/ipm/sessions/{sessionId}", path(sessionId)).then(unwrap)).data,

  correct: async (sessionId: string, reason: string): Promise<IpmSession> =>
    (await typedApi.POST("/api/v1/ipm/sessions/{sessionId}/corrections", { ...path(sessionId), body: { reason } }).then(unwrap)).data,

  editHeader: async (sessionId: string, body: IpmHeaderBody): Promise<IpmSession> =>
    (await typedApi.PATCH("/api/v1/ipm/sessions/{sessionId}", { ...path(sessionId), body }).then(unwrap)).data,

  submit: async (sessionId: string, revision: number): Promise<IpmSession> =>
    (await typedApi.POST("/api/v1/ipm/sessions/{sessionId}/submit", { ...path(sessionId), body: { revision } }).then(unwrap)).data,

  discard: async (sessionId: string, reason?: string): Promise<IpmSession> =>
    (await typedApi.POST("/api/v1/ipm/sessions/{sessionId}/discard", { ...path(sessionId), body: reason ? { reason } : {} }).then(unwrap))
      .data,

  voidSession: async (sessionId: string, reason: string): Promise<IpmSession> =>
    (await typedApi.POST("/api/v1/ipm/sessions/{sessionId}/void", { ...path(sessionId), body: { reason } }).then(unwrap)).data,
};
