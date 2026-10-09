/**
 * P22-01 — the catalogue service against the backend contract (P21-01: deviceTypes.route.ts,
 * ipm.route.ts, admin.route.ts; the paths, methods and bodies of `schema.d.ts`). Each case pins
 * the exact path, the method, the body and the envelope unwrap: rows in `data`, paging in the
 * TOP-LEVEL `meta` (never `data.rows`), and a list without `meta` read as one page of what came.
 */
import { ipmCatalogueService as svc } from "./ipmCatalogue.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mocked = api as jest.Mocked<typeof api>;
const ok = <T,>(data: T, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });
const META = { total: 30, page: 2, limit: 25, totalPages: 2 };
const ID = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";

describe("ipmCatalogueService (P22-01)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("lists: rows in data, paging in the top-level meta", () => {
    it.each([
      ["listDeviceTypes", "/api/v1/device-types", { page: 2, limit: 25, status: "all", search: "pump" }],
      ["listItemDefinitions", "/api/v1/ipm/item-definitions", { page: 2, section: "function", status: "active" }],
      ["listTemplates", "/api/v1/ipm/templates", { page: 2, hasDraft: true }],
      ["listProposals", "/api/v1/ipm/template-proposals", { page: 2, status: "submitted" }],
      ["listProposalQueue", "/api/v1/admin/ipm/template-proposals", { page: 2, status: "submitted" }],
    ] as const)("%s GETs %s with the query as params", async (fn, path, query) => {
      mocked.get.mockResolvedValueOnce(ok([{ id: "r1" }], META));
      const list = svc[fn] as (q: unknown) => Promise<{ rows: unknown[]; meta: unknown }>;
      const page = await list(query);
      expect(mocked.get).toHaveBeenCalledWith(path, { params: query });
      expect(page).toEqual({ rows: [{ id: "r1" }], meta: META });
    });

    it("reads a list without meta as one page, and a null data as none", async () => {
      mocked.get.mockResolvedValueOnce(ok([{ id: "a" }, { id: "b" }]));
      expect((await svc.listDeviceTypes({ page: 3 })).meta).toEqual({ total: 2, page: 3, limit: 2, totalPages: 1 });
      mocked.get.mockResolvedValueOnce(ok(null));
      expect(await svc.listDeviceTypes()).toEqual({ rows: [], meta: { total: 0, page: 1, limit: 0, totalPages: 1 } });
    });

    it("listVersions asks for one template's history", async () => {
      mocked.get.mockResolvedValueOnce(ok([], { total: 0, page: 1, limit: 10, totalPages: 0 }));
      await svc.listVersions(ID, 1, 10);
      expect(mocked.get).toHaveBeenCalledWith("/api/v1/ipm/template-versions", { params: { templateId: ID, page: 1, limit: 10 } });
      mocked.get.mockResolvedValueOnce(ok([]));
      await svc.listVersions(ID);
      expect(mocked.get).toHaveBeenLastCalledWith("/api/v1/ipm/template-versions", { params: { templateId: ID, page: 1, limit: 25 } });
    });
  });

  describe("device types", () => {
    it("creates, renames, retires and reactivates", async () => {
      mocked.post.mockResolvedValue(ok({ id: ID, name: "Infusion pump", status: "active" }));
      mocked.patch.mockResolvedValue(ok({ id: ID, name: "Syringe pump", status: "active" }));
      expect((await svc.createDeviceType("Infusion pump")).name).toBe("Infusion pump");
      expect(mocked.post).toHaveBeenCalledWith("/api/v1/device-types", { name: "Infusion pump" });
      expect((await svc.renameDeviceType(ID, "Syringe pump")).name).toBe("Syringe pump");
      expect(mocked.patch).toHaveBeenCalledWith(`/api/v1/device-types/${ID}`, { name: "Syringe pump" });
      await svc.retireDeviceType(ID);
      expect(mocked.post).toHaveBeenLastCalledWith(`/api/v1/device-types/${ID}/retire`);
      await svc.reactivateDeviceType(ID);
      expect(mocked.post).toHaveBeenLastCalledWith(`/api/v1/device-types/${ID}/reactivate`);
    });
  });

  describe("the item library", () => {
    const body = { content: { section: "function" as const, label: "Alarm works", symbol: null, inputKind: "tri_state" as const, allowedOutcomes: ["pass" as const, "fail" as const] }, defaultRequired: true, notes: null };

    it("creates with the content union, edits by PATCH, retires by POST", async () => {
      mocked.post.mockResolvedValue(ok({ id: ID }));
      mocked.patch.mockResolvedValue(ok({ id: ID }));
      await svc.createItemDefinition(body);
      expect(mocked.post).toHaveBeenCalledWith("/api/v1/ipm/item-definitions", body);
      await svc.updateItemDefinition(ID, { defaultRequired: false });
      expect(mocked.patch).toHaveBeenCalledWith(`/api/v1/ipm/item-definitions/${ID}`, { defaultRequired: false });
      await svc.retireItemDefinition(ID);
      expect(mocked.post).toHaveBeenLastCalledWith(`/api/v1/ipm/item-definitions/${ID}/retire`);
    });
  });

  describe("templates and versions", () => {
    it("creates a type's checklist, retires and reactivates it, opens a draft", async () => {
      mocked.post.mockResolvedValue(ok({ id: ID }));
      await svc.createTemplate(ID);
      expect(mocked.post).toHaveBeenCalledWith("/api/v1/ipm/templates", { deviceTypeId: ID });
      await svc.retireTemplate(ID);
      expect(mocked.post).toHaveBeenLastCalledWith(`/api/v1/ipm/templates/${ID}/retire`);
      await svc.reactivateTemplate(ID);
      expect(mocked.post).toHaveBeenLastCalledWith(`/api/v1/ipm/templates/${ID}/reactivate`);
      await svc.openDraft(ID, "empty");
      expect(mocked.post).toHaveBeenLastCalledWith(`/api/v1/ipm/templates/${ID}/versions`, { copyFrom: "empty" });
    });

    it("reads a version, saves items and the note at a revision, publishes, discards", async () => {
      mocked.get.mockResolvedValueOnce(ok({ id: ID, items: [] }));
      expect((await svc.getVersion(ID)).id).toBe(ID);
      expect(mocked.get).toHaveBeenCalledWith(`/api/v1/ipm/template-versions/${ID}`);

      mocked.put.mockResolvedValueOnce(ok({ id: ID, revision: 4 }));
      await svc.saveDraftItems(ID, 3, [{ itemDefinitionId: ID, required: true }]);
      expect(mocked.put).toHaveBeenCalledWith(`/api/v1/ipm/template-versions/${ID}/items`, { revision: 3, items: [{ itemDefinitionId: ID, required: true }] });

      mocked.patch.mockResolvedValueOnce(ok({ id: ID, revision: 5 }));
      await svc.saveDraftNote(ID, 4, "Adds the alarm check");
      expect(mocked.patch).toHaveBeenCalledWith(`/api/v1/ipm/template-versions/${ID}`, { revision: 4, changeNote: "Adds the alarm check" });

      mocked.post.mockResolvedValueOnce(ok({ version: { id: ID }, retiredVersionId: null, rebasedVersionIds: [] }));
      expect((await svc.publishDraft(ID, 5, "Adds the alarm check")).rebasedVersionIds).toEqual([]);
      expect(mocked.post).toHaveBeenCalledWith(`/api/v1/ipm/template-versions/${ID}/publish`, { revision: 5, changeNote: "Adds the alarm check" });

      mocked.post.mockResolvedValueOnce(ok({ id: ID, status: "discarded" }));
      await svc.discardDraft(ID);
      expect(mocked.post).toHaveBeenLastCalledWith(`/api/v1/ipm/template-versions/${ID}/discard`);
    });

    it("reads the published catalogue as one document", async () => {
      const doc = { schema: "inspection-catalogue-v1", deviceTypes: [], versions: [] };
      mocked.get.mockResolvedValueOnce(ok(doc));
      expect(await svc.getPublishedCatalogue()).toEqual(doc);
      expect(mocked.get).toHaveBeenCalledWith("/api/v1/ipm/templates/published");
    });
  });

  describe("proposals", () => {
    it("creates and withdraws in the caller's tenant (no tenantId in the body)", async () => {
      mocked.post.mockResolvedValue(ok({ id: ID, status: "submitted" }));
      const body = { kind: "new_device_type" as const, proposedDeviceTypeName: "Bed scale", proposedItems: [], reason: "We service these" };
      await svc.createProposal(body);
      expect(mocked.post).toHaveBeenCalledWith("/api/v1/ipm/template-proposals", body);
      await svc.withdrawProposal(ID);
      expect(mocked.post).toHaveBeenLastCalledWith(`/api/v1/ipm/template-proposals/${ID}/withdraw`);
    });

    it("accepts and rejects on the admin router", async () => {
      mocked.post.mockResolvedValue(ok({ id: ID }));
      await svc.acceptProposal(ID, { deviceTypeId: ID });
      expect(mocked.post).toHaveBeenCalledWith(`/api/v1/admin/ipm/template-proposals/${ID}/accept`, { deviceTypeId: ID });
      await svc.rejectProposal(ID, "Already covered");
      expect(mocked.post).toHaveBeenLastCalledWith(`/api/v1/admin/ipm/template-proposals/${ID}/reject`, { decisionNote: "Already covered" });
    });
  });

  it("rejects with the client's error (a 409 is not swallowed)", async () => {
    mocked.post.mockRejectedValueOnce(Object.assign(new Error("This device type is already retired."), { response: { status: 409 } }));
    await expect(svc.retireDeviceType(ID)).rejects.toThrow("This device type is already retired.");
  });
});
