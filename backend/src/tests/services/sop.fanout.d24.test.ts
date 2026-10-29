/**
 * D-24 (ADR-070) -- the SOP training fan-out is bounded.
 *
 * publishDocument read EVERY user of the tenant into memory and inserted one
 * acknowledgement per user in ONE statement -- its size and bind-parameter
 * count (PostgreSQL's limit is 65,535) grew with the hospital. It now reads a
 * keyset page of ids at a time and inserts a page at a time, all inside the
 * publish's transaction. Tested at a realistic size (1,234 and 1,000 users),
 * not two.
 */
import type * as SequelizeModule from "sequelize";

const mockUsers: { rows: { id: string; tenantId: string }[] } = { rows: [] };

jest.mock("../../models", () => {
  const { Op } = jest.requireActual<typeof SequelizeModule>("sequelize");
  return {
    SopDocument: { findOne: jest.fn() },
    SopTrainingAcknowledgment: { bulkCreate: jest.fn().mockResolvedValue([]) },
    // A keyset reader over mockUsers.rows, honouring where.id[Op.gt], order and limit.
    User: {
      findAll: jest.fn(({ where, limit }: { where: { tenantId: string; id?: unknown }; limit: number }) => {
        const after = (where.id as Record<symbol, string> | undefined)?.[Op.gt] ?? null;
        return Promise.resolve(
          mockUsers.rows
            .filter((u) => u.tenantId === where.tenantId && (after === null || u.id > after))
            .sort((a, b) => (a.id < b.id ? -1 : 1))
            .slice(0, limit)
            .map((u) => ({ id: u.id })),
        );
      }),
    },
    AuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
});

jest.mock("../../config", () => ({
  db: { transaction: jest.fn((cb: (tx: string) => unknown) => Promise.resolve(cb("TX"))) },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

interface ModelsDouble {
  SopDocument: { findOne: jest.Mock };
  SopTrainingAcknowledgment: { bulkCreate: jest.Mock };
  User: { findAll: jest.Mock };
}

interface SopService {
  publishDocument: (tenantId: string, id: string, publisher: string) => Promise<{ status: string }>;
  TRAINING_FANOUT_BATCH: number;
}

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { SopDocument, SopTrainingAcknowledgment, User } = require("../../models") as ModelsDouble;
const sopService = require("../../services/sop.service") as SopService;
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "tenant-1";
const OTHER = "tenant-2";

const seedUsers = (n: number, tenantId: string = TENANT): { id: string; tenantId: string }[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u-${String(i).padStart(6, "0")}`, tenantId }));

const publish = (): Promise<{ status: string }> => {
  SopDocument.findOne.mockResolvedValueOnce({
    id: "sop-1",
    documentNumber: "SOP-0001",
    version: "1.0",
    authorId: "author",
    requiresTraining: true,
    status: "DRAFT",
    save: jest.fn().mockResolvedValue(true),
  });
  return sopService.publishDocument(TENANT, "sop-1", "publisher");
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("D-24 -- SOP training fan-out in batches", () => {
  it("assigns every one of 1,234 users exactly once, in pages of the batch size, in the publish's transaction", async () => {
    mockUsers.rows = [...seedUsers(1234), ...seedUsers(40, OTHER)];

    await publish();

    const batches = SopTrainingAcknowledgment.bulkCreate.mock.calls as [
      Record<string, unknown>[],
      { transaction: unknown },
    ][];
    expect(sopService.TRAINING_FANOUT_BATCH).toBe(500);
    expect(batches.map(([rows]) => rows.length)).toEqual([500, 500, 234]);
    for (const [rows, options] of batches) {
      expect(options).toEqual({ transaction: "TX" });
      expect(
        rows.every((r) => r["tenantId"] === TENANT && r["documentId"] === "sop-1" && r["status"] === "PENDING"),
      ).toBe(true);
    }
    const assigned = batches.flatMap(([rows]) => rows.map((r) => r["userId"]));
    expect(new Set(assigned).size).toBe(1234);
    expect(assigned).toEqual(seedUsers(1234).map((u) => u.id));

    // Only ids are read, never whole user rows, and never more than a page.
    for (const [options] of User.findAll.mock.calls as [
      { attributes: unknown; limit: unknown; transaction: unknown },
    ][]) {
      expect(options.attributes).toEqual(["id"]);
      expect(options.limit).toBe(500);
      expect(options.transaction).toBe("TX");
    }
  });

  it("an exact multiple of the batch ends on an empty page without an empty insert", async () => {
    mockUsers.rows = seedUsers(1000);

    await publish();

    expect(User.findAll).toHaveBeenCalledTimes(3);
    expect(
      (SopTrainingAcknowledgment.bulkCreate.mock.calls as [Record<string, unknown>[]][]).map(
        ([rows]) => rows.length,
      ),
    ).toEqual([500, 500]);
  });

  it("a tenant with no users assigns nothing and still publishes", async () => {
    mockUsers.rows = [];

    const doc = await publish();

    expect(doc.status).toBe("PUBLISHED");
    expect(SopTrainingAcknowledgment.bulkCreate).not.toHaveBeenCalled();
  });

  it("a failing batch rejects the publish, so its transaction rolls back every earlier batch", async () => {
    mockUsers.rows = seedUsers(1234);
    SopTrainingAcknowledgment.bulkCreate.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("insert failed"));

    await expect(publish()).rejects.toThrow("insert failed");
  });
});
