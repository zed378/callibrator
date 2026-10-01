/**
 * F-19 (ADR-105 Amendment 1) — an ARCHIVED SOP is no longer in force, so a
 * training acknowledgement left pending from before it was archived no longer
 * applies. POST /sop/:id/acknowledge used to complete it anyway (the service
 * looked only at the acknowledgement row). It is now a 409 state explanation,
 * and the row is not written. The SOP screen already hides the action there.
 *
 * REAL sop router, controller, service and audit service on the REAL models
 * and tenant hooks (fixtures/memoryDb).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as SopRoute from "../../routes/api/sop.route";
import type ModelsBarrel from "../../models";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof SopRoute>("../../routes/api/sop.route");
const models = jest.requireActual<typeof ModelsBarrel>("../../models");

const SOP = "c1f19000-0000-4000-8000-000000000001";
const ACK = "c1f19000-0000-4000-8000-000000000002";

let fx: ReturnType<typeof twoTenants>;
let tech: ReturnType<ReturnType<typeof twoTenants>["principal"]>;

const seed = (status: string): void => {
  mdb.seed("SopDocument", {
    id: SOP,
    tenantId: fx.tenantA.id,
    documentNumber: "SOP-001",
    title: "Defibrillator energy check",
    version: "1.0",
    status,
    requiresTraining: true,
    authorId: tech.id,
  });
  mdb.seed("SopTrainingAcknowledgment", {
    id: ACK,
    tenantId: fx.tenantA.id,
    documentId: SOP,
    userId: tech.id,
    status: "PENDING",
  });
};

const storedAck = async (): Promise<{ status: unknown; acknowledgedAt: unknown } | null> => {
  const row = await models.SopTrainingAcknowledgment.unscoped().findOne({ where: { id: ACK }, skipTenantScope: true });
  return row ? { status: row.status, acknowledgedAt: row.acknowledgedAt ?? null } : null;
};

beforeEach(() => {
  mdb.reset();
  fx = twoTenants();
  tech = fx.principal(fx.tenantA, "TECHNICIAN");
  seedTenants(mdb, fx, [tech]);
  as(tech);
});

describe("F-19 — acknowledging an ARCHIVED SOP", () => {
  it("is a 409 that says the SOP is archived, and the acknowledgement stays pending", async () => {
    seed("ARCHIVED");
    const res = await call(router, "POST", `/${SOP}/acknowledge`);

    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toBe(
      "This SOP is archived and no longer requires acknowledgement.",
    );
    expect(await storedAck()).toEqual({ status: "PENDING", acknowledgedAt: null });
  });

  it("control: a PUBLISHED SOP is acknowledged", async () => {
    seed("PUBLISHED");
    const res = await call(router, "POST", `/${SOP}/acknowledge`);

    expect(res.status).toBe(200);
    expect((await storedAck())?.status).toBe("COMPLETED");
  });
});
