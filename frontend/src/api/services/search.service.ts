// src/api/services/search.service.ts
import { api } from "../client";

export type SearchResultType = "device" | "stock" | "certificate";

export interface DeviceSearchResult {
  type: "device";
  id: string;
  name: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  category?: string;
  rank: number;
}

export interface StockSearchResult {
  type: "stock";
  id: string;
  itemName: string;
  sku?: string;
  serialNumber?: string;
  quantity: number;
  rank: number;
}

export interface CertificateSearchResult {
  type: "certificate";
  id: string;
  certificateNumber: string;
  status: string;
  standard?: string;
  deviceId: string;
  rank: number;
}

export type SearchResult =
  | DeviceSearchResult
  | StockSearchResult
  | CertificateSearchResult;

export interface SearchResponse {
  query: string;
  total: number;
  results: SearchResult[];
  byType: {
    device?: DeviceSearchResult[];
    stock?: StockSearchResult[];
    certificate?: CertificateSearchResult[];
  };
}

// Backend response envelope
interface BackendSearchResponse {
  success: boolean;
  status: number;
  message: string;
  data: SearchResponse;
}

export const searchService = {
  /**
   * Global search across devices, stock and certificates
   */
  search: async (
    q: string,
    types?: SearchResultType[],
    limit?: number,
  ): Promise<SearchResponse> => {
    const response = await api.get<BackendSearchResponse>("/api/v1/search", {
      params: {
        q,
        types: types && types.length > 0 ? types.join(",") : undefined,
        limit: limit || undefined,
      },
    });
    return response.data;
  },
};

export default searchService;
