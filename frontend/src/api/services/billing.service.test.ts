import { billingService } from "./billing.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const envelope = <T,>(data: T, meta?: unknown) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
  ...(meta ? { meta } : {}),
});

describe("billingService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getSubscription", () => {
    it("GETs the subscription and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ id: "s1", status: "Active" }),
      );

      const res = await billingService.getSubscription();

      expect(mockedApi.get).toHaveBeenCalledWith(
        "/api/v1/billing/subscription",
      );
      expect(res).toEqual({ id: "s1", status: "Active" });
    });
  });

  describe("updateSubscription", () => {
    it("PATCHes the subscription with the input and unwraps data", async () => {
      mockedApi.patch.mockResolvedValueOnce(
        envelope({ id: "s1", planId: "pro" }),
      );

      const input = { planId: "pro", billingCycle: "Annually" as const };
      const res = await billingService.updateSubscription(input);

      expect(mockedApi.patch).toHaveBeenCalledWith(
        "/api/v1/billing/subscription",
        input,
      );
      expect(res).toEqual({ id: "s1", planId: "pro" });
    });
  });

  describe("getInvoices", () => {
    it("GETs invoices with default params (status undefined) and unwraps rows + meta", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ id: "i1" }], {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      );

      const res = await billingService.getInvoices();

      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/billing/invoices", {
        params: { page: 1, limit: 10, status: undefined },
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it("forwards an explicit status filter", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([]));

      await billingService.getInvoices(2, 5, "Paid");

      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/billing/invoices", {
        params: { page: 2, limit: 5, status: "Paid" },
      });
    });

    it("falls back to [] and synthesizes meta (totalPages 0 when empty) when data/meta absent", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));

      const res = await billingService.getInvoices(3, 20);

      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({
        total: 0,
        page: 3,
        limit: 20,
        totalPages: 0,
      });
    });
  });
});
