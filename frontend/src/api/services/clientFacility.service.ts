import { typedApi, unwrap, type components } from "../typed";

/**
 * P22-05 — the tenant's client facilities, short form (`GET /client-facilities/options`; P21-09).
 * Gated on `calibration`, `ipm` or `client-facilities` read. A list's facility filter is a
 * convenience for provider staff, never a boundary: a facility-bound reader's reads are already
 * scoped to its facility by the server, so a page does not offer it the filter.
 */
export type ClientFacilityOption = components["schemas"]["ClientFacilityOption"];

export const clientFacilityService = {
  /** Every facility of the tenant (`data` is the array; no paging). */
  options: async (): Promise<ClientFacilityOption[]> =>
    (await typedApi.GET("/api/v1/client-facilities/options").then(unwrap)).data ?? [],
};
