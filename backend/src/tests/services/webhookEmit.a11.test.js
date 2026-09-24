/**
 * A-11 — the domain events in constants/webhookEvents.js are emitted by the
 * services, from `transaction.afterCommit`: a committed change is announced
 * once, a rolled-back one never.
 *
 * The transaction double below keeps Sequelize's contract for afterCommit:
 * hooks registered inside the transaction run after a successful COMMIT and
 * are discarded on rollback (managed: the callback throws; unmanaged: the
 * caller rolls back; either: the COMMIT itself fails). webhook.service is
 * replaced by a recorder that honours the same contract, so what is asserted
 * here is each service's use of it: the right event, the right transaction,
 * the right payload. emitAfterCommit's own behaviour on a real Transaction is
 * proved in webhook.durable.a10.live.test.js.
 */

const fs = require("fs");
const path = require("path");

const mockEmitted = [];
const mockTx = { commitFails: false, all: [] };

const mockMakeTx = () => {
  const tx = {
    hooks: [],
    finished: null,
    afterCommit(fn) {
      this.hooks.push(fn);
    },
    async commit() {
      if (mockTx.commitFails) {
        this.finished = "rollback";
        throw new Error("COMMIT failed");
      }
      this.finished = "commit";
      this.hooks.forEach((h) => h());
    },
    async rollback() {
      this.finished = "rollback";
    },
  };
  mockTx.all.push(tx);
  return tx;
};

jest.mock("../../config", () => ({
  db: {
    // Managed with a callback, unmanaged without — as sequelize.transaction().
    transaction: jest.fn(async (cb) => {
      const tx = mockMakeTx();
      if (typeof cb !== "function") {
        return tx;
      }
      let result;
      try {
        result = await cb(tx);
      } catch (err) {
        await tx.rollback();
        throw err;
      }
      await tx.commit();
      return result;
    }),
    query: jest.fn(async () => [[{ seq: 7 }]]), // qms claimNumber
  },
}));

jest.mock("../../services/webhook.service", () => ({
  emitAfterCommit: jest.fn((transaction, tenantId, event, payload) => {
    const emit = () => mockEmitted.push({ tenantId, event, payload });
    if (transaction) {
      transaction.afterCommit(emit);
    } else {
      emit();
    }
  }),
}));

jest.mock("../../models", () => ({
  Certificate: { findOne: jest.fn() },
  ESignatureRecord: { create: jest.fn().mockResolvedValue({}) },
  User: { findByPk: jest.fn(), findOne: jest.fn().mockResolvedValue({ id: "u-2" }) },
  CalibrationDevice: { findOne: jest.fn() },
  NonConformance: { findOne: jest.fn() },
  Capa: { create: jest.fn(), findOne: jest.fn() },
  MaintenanceWorkOrder: { create: jest.fn(), findOne: jest.fn() },
  StockTransfer: { findOne: jest.fn() },
  Stock: { findOne: jest.fn(), findOrCreate: jest.fn() },
}));

jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../services/auth.service", () => ({
  passIsValid: jest.fn().mockResolvedValue({ data: { valid: true } }),
}));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const models = require("../../models");
const webhookService = require("../../services/webhook.service");
const certificateService = require("../../services/certificate.service");
const maintenanceService = require("../../services/maintenance.service");
const stockService = require("../../services/stock.service");
const qmsService = require("../../services/qms.service");
const { WEBHOOK_EVENTS, WEBHOOK_EVENT_NAMES } = require("../../constants/webhookEvents");

const T = "tenant-1";
const AUTH = { authMethod: "password", authPayload: "pw", meaning: "Approved" };

const cert = (status) => {
  const c = { id: "cert-1", certificateNumber: "CERT-1", deviceId: "dev-1", status };
  c.approve = jest.fn(async () => (c.status = "approved"));
  c.sign = jest.fn(async () => (c.status = "signed"));
  c.revoke = jest.fn(async () => (c.status = "revoked"));
  c.save = jest.fn().mockResolvedValue(c);
  return c;
};

const instance = (fields) => {
  const r = { ...fields };
  r.update = jest.fn(async (patch) => Object.assign(r, patch));
  r.save = jest.fn().mockResolvedValue(r);
  r.toJSON = () => ({ ...r });
  return r;
};

beforeEach(() => {
  mockEmitted.length = 0;
  mockTx.commitFails = false;
  mockTx.all.length = 0;
});

describe("A-11 — certificates", () => {
  it("certificate.approved is emitted after the approval commits, with identifiers only", async () => {
    models.Certificate.findOne.mockResolvedValueOnce(cert("pending_approval"));
    await certificateService.approveCertificate(T, "cert-1", "u-2", AUTH);
    expect(webhookService.emitAfterCommit).toHaveBeenCalledWith(
      mockTx.all[0],
      T,
      WEBHOOK_EVENTS.CERTIFICATE_APPROVED,
      expect.any(Object),
    );
    expect(mockEmitted).toEqual([
      {
        tenantId: T,
        event: "certificate.approved",
        payload: { certificateId: "cert-1", certificateNumber: "CERT-1", deviceId: "dev-1", status: "approved", approvedBy: "u-2" },
      },
    ]);
  });

  it("certificate.signed is emitted after the signature commits", async () => {
    models.Certificate.findOne.mockResolvedValueOnce(cert("approved"));
    await certificateService.signCertificate(T, "cert-1", "sig", "k1", "u-2", { ...AUTH, meaning: "Signed" });
    expect(mockEmitted).toEqual([
      expect.objectContaining({ event: "certificate.signed", payload: expect.objectContaining({ status: "signed", signedBy: "u-2" }) }),
    ]);
  });

  it("certificate.revoked is emitted after the revocation commits, without the free-text reason", async () => {
    models.Certificate.findOne.mockResolvedValueOnce(cert("signed"));
    await certificateService.revokeCertificate(T, "cert-1", "patient data in the reason", "u-2", { ...AUTH, meaning: "Revoked" });
    expect(mockEmitted).toHaveLength(1);
    expect(mockEmitted[0]).toMatchObject({ event: "certificate.revoked", payload: { status: "revoked", revokedBy: "u-2" } });
    expect(JSON.stringify(mockEmitted[0].payload)).not.toContain("patient data");
  });

  it("a certificate transition whose COMMIT fails emits nothing", async () => {
    models.Certificate.findOne.mockResolvedValueOnce(cert("pending_approval"));
    mockTx.commitFails = true;
    await expect(certificateService.approveCertificate(T, "cert-1", "u-2", AUTH)).rejects.toThrow("COMMIT failed");
    expect(webhookService.emitAfterCommit).toHaveBeenCalled(); // registered…
    expect(mockEmitted).toEqual([]); // …but never fired
  });

  it("a refused transition (409) emits nothing", async () => {
    models.Certificate.findOne.mockResolvedValueOnce(cert("revoked"));
    await expect(certificateService.approveCertificate(T, "cert-1", "u-2", AUTH)).rejects.toMatchObject({ status: 409 });
    expect(mockEmitted).toEqual([]);
  });
});

describe("A-11 — maintenance work orders (autocommitted writes)", () => {
  it("work_order.created is emitted once the insert has happened", async () => {
    models.MaintenanceWorkOrder.create.mockResolvedValueOnce(
      instance({ id: "wo-1", deviceId: "dev-1", type: "Preventative", status: "Open", priority: "High", title: "t" }),
    );
    await maintenanceService.createWorkOrder(T, { title: "t", deviceId: "dev-1" });
    expect(webhookService.emitAfterCommit).toHaveBeenCalledWith(null, T, "work_order.created", expect.any(Object));
    expect(mockEmitted).toEqual([
      { tenantId: T, event: "work_order.created", payload: { workOrderId: "wo-1", deviceId: "dev-1", type: "Preventative", status: "Open", priority: "High" } },
    ]);
  });

  it("a failed insert emits nothing", async () => {
    models.MaintenanceWorkOrder.create.mockRejectedValueOnce(new Error("insert failed"));
    await expect(maintenanceService.createWorkOrder(T, { title: "t" })).rejects.toMatchObject({ status: 500 });
    expect(mockEmitted).toEqual([]);
  });

  it("work_order.completed is emitted on the transition into Completed", async () => {
    models.MaintenanceWorkOrder.findOne.mockResolvedValueOnce(
      instance({ id: "wo-1", deviceId: "dev-1", type: "Repair", status: "InProgress" }),
    );
    await maintenanceService.updateWorkOrder(T, "wo-1", { status: "Completed" });
    expect(mockEmitted).toEqual([
      { tenantId: T, event: "work_order.completed", payload: { workOrderId: "wo-1", deviceId: "dev-1", type: "Repair", status: "Completed" } },
    ]);
  });

  it("editing an already-completed work order, or any other status change, emits nothing", async () => {
    models.MaintenanceWorkOrder.findOne.mockResolvedValueOnce(instance({ id: "wo-1", status: "Completed" }));
    await maintenanceService.updateWorkOrder(T, "wo-1", { title: "renamed" });
    models.MaintenanceWorkOrder.findOne.mockResolvedValueOnce(instance({ id: "wo-2", status: "Open" }));
    await maintenanceService.updateWorkOrder(T, "wo-2", { status: "InProgress" });
    expect(mockEmitted).toEqual([]);
  });
});

describe("A-11 — stock transfers (unmanaged transaction)", () => {
  const transfer = (status = "pending") =>
    instance({ id: "tr-1", status, itemName: "Probe", quantity: 2, fromWarehouseId: "wh-1", toWarehouseId: "wh-2" });

  it("stock_transfer.completed is emitted after the transfer's commit", async () => {
    models.StockTransfer.findOne.mockResolvedValueOnce(transfer());
    models.Stock.findOne.mockResolvedValueOnce(instance({ quantity: 10, sku: "S" }));
    models.Stock.findOrCreate.mockResolvedValueOnce([instance({ quantity: 1 }), false]);
    await stockService.updateTransferStatus(T, "tr-1", { status: "completed" }, "u-2");
    expect(webhookService.emitAfterCommit).toHaveBeenCalledWith(mockTx.all[0], T, "stock_transfer.completed", expect.any(Object));
    expect(mockEmitted).toEqual([
      {
        tenantId: T,
        event: "stock_transfer.completed",
        payload: { transferId: "tr-1", itemName: "Probe", quantity: 2, fromWarehouseId: "wh-1", toWarehouseId: "wh-2", approvedBy: "u-2" },
      },
    ]);
  });

  it("a transfer whose COMMIT fails emits nothing", async () => {
    models.StockTransfer.findOne.mockResolvedValueOnce(transfer());
    models.Stock.findOne.mockResolvedValueOnce(instance({ quantity: 10 }));
    models.Stock.findOrCreate.mockResolvedValueOnce([instance({ quantity: 1 }), false]);
    mockTx.commitFails = true;
    await expect(stockService.updateTransferStatus(T, "tr-1", { status: "completed" }, "u-2")).rejects.toThrow("COMMIT failed");
    expect(mockEmitted).toEqual([]);
  });

  it("a cancelled transfer emits nothing", async () => {
    models.StockTransfer.findOne.mockResolvedValueOnce(transfer());
    await stockService.updateTransferStatus(T, "tr-1", { status: "cancelled" }, "u-2");
    expect(mockEmitted).toEqual([]);
  });
});

describe("A-11 — CAPA", () => {
  it("capa.created is emitted after the create commits", async () => {
    models.NonConformance.findOne.mockResolvedValueOnce({ id: "nc-1", ncNumber: "NC-00001" });
    models.Capa.create.mockResolvedValueOnce({ id: "capa-1" });
    await qmsService.createCapa(T, { ncId: "nc-1", title: "Fix", actionPlan: "plan", dueDate: "2026-10-01" }, { userId: "u-2" });
    expect(mockEmitted).toEqual([
      {
        tenantId: T,
        event: "capa.created",
        payload: { capaId: "capa-1", capaNumber: "CAPA-00007", ncId: "nc-1", ncNumber: "NC-00001", status: "DRAFT", dueDate: "2026-10-01" },
      },
    ]);
  });

  it("a CAPA create whose COMMIT fails emits nothing", async () => {
    models.NonConformance.findOne.mockResolvedValueOnce({ id: "nc-1", ncNumber: "NC-00001" });
    models.Capa.create.mockResolvedValueOnce({ id: "capa-1" });
    mockTx.commitFails = true;
    await expect(qmsService.createCapa(T, { ncId: "nc-1", title: "Fix", actionPlan: "plan" })).rejects.toThrow("COMMIT failed");
    expect(mockEmitted).toEqual([]);
  });

  it("capa.closed is emitted on the transition into CLOSED, naming the caller", async () => {
    models.Capa.findOne.mockResolvedValueOnce(instance({ id: "capa-1", capaNumber: "CAPA-00007", ncId: "nc-1", status: "VERIFICATION" }));
    await qmsService.updateCapa(T, "capa-1", { status: "CLOSED" }, { userId: "u-2" });
    expect(mockEmitted).toEqual([
      { tenantId: T, event: "capa.closed", payload: { capaId: "capa-1", capaNumber: "CAPA-00007", ncId: "nc-1", status: "CLOSED", closedBy: "u-2" } },
    ]);
  });

  it("capa.closed without an actor records closedBy null", async () => {
    models.Capa.findOne.mockResolvedValueOnce(instance({ id: "capa-1", status: "OPEN" }));
    await qmsService.updateCapa(T, "capa-1", { status: "CLOSED" });
    expect(mockEmitted[0].payload.closedBy).toBeNull();
  });

  it("re-saving a CLOSED CAPA, or moving to another status, emits nothing", async () => {
    models.Capa.findOne.mockResolvedValueOnce(instance({ id: "capa-1", status: "CLOSED" }));
    await qmsService.updateCapa(T, "capa-1", { status: "CLOSED" });
    models.Capa.findOne.mockResolvedValueOnce(instance({ id: "capa-2", status: "OPEN" }));
    await qmsService.updateCapa(T, "capa-2", { status: "IN_PROGRESS" });
    expect(mockEmitted).toEqual([]);
  });
});

describe("A-11 — the catalogue is what is emitted", () => {
  const services = path.join(__dirname, "../../services");
  const source = fs
    .readdirSync(services)
    .filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(services, f), "utf8"))
    .join("\n");

  it.each(Object.entries(WEBHOOK_EVENTS))("%s (%s) has an emit site in a service", (key, name) => {
    const byConstant = source.includes(`WEBHOOK_EVENTS.${key}`);
    const byLiteral = source.includes(`"${name}"`);
    expect(byConstant || byLiteral).toBe(true);
  });

  it("every name is one the subscription validator accepts", () => {
    const { createWebhookSchema } = require("../../validators/webhook.validator");
    const { error } = createWebhookSchema.validate({ url: "https://x.example/h", events: [...WEBHOOK_EVENT_NAMES] });
    expect(error).toBeUndefined();
  });

  it("the frontend offers exactly `*` and the catalogue — and no longer the inert webhook.test", () => {
    const modal = fs.readFileSync(
      path.join(__dirname, "../../../../frontend/src/app/dashboard/webhooks/components/WebhookModal.tsx"),
      "utf8",
    );
    const block = modal.match(/const PREDEFINED_EVENTS = \[([\s\S]*?)\];/)[1];
    const offered = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(offered).toEqual(["*", ...WEBHOOK_EVENT_NAMES]);
  });
});
