// P9-25 (ADR-103 item 11): on the GENERATED client; the result types are the
// contract's own (backend/src/routes/api/search.openapi.ts).
// src/api/services/search.service.ts
import { typedApi, unwrap, type components } from "../typed";

export type SearchResponse = components["schemas"]["SearchResults"];
export type SearchResult = SearchResponse["results"][number];
export type SearchResultType = SearchResult["type"];
export type DeviceSearchResult = Extract<SearchResult, { type: "device" }>;
export type StockSearchResult = Extract<SearchResult, { type: "stock" }>;
export type CertificateSearchResult = Extract<SearchResult, { type: "certificate" }>;

export const searchErrorMessage = (err: unknown): string => {
  const detail =
    err instanceof Error && err.message ? err.message : "Unknown error";
  const body = (err as { response?: { data?: { requestId?: unknown } } })
    ?.response?.data;
  const requestId =
    typeof body?.requestId === "string" ? body.requestId : undefined;
  return requestId
    ? `Search failed: ${detail} (reference ${requestId})`
    : `Search failed: ${detail}`;
};

export const searchService = {
  /**
   * Global search across devices, stock and certificates
   */
  search: async (
    q: string,
    types?: SearchResultType[],
    limit?: number,
  ): Promise<SearchResponse> => {
    const response = await typedApi
      .GET("/api/v1/search", {
        params: {
          query: {
            q,
            types: types && types.length > 0 ? types.join(",") : undefined,
            limit: limit || undefined,
          },
        },
      })
      .then(unwrap);
    return response.data;
  },
};

export default searchService;
