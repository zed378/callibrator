/**
 * P9-10 (ADR-087 Amendment 7) — the converted models' TYPES bite.
 *
 * Every `@ts-expect-error` below must be used: `npm run typecheck` fails on an
 * unused one (TS2578), so a type that loosens (an attribute widened to
 * `string`, a brand lost, an association typed as an attribute) fails the
 * typecheck, not only a reviewer. The functions are never called at run time;
 * the one runtime test builds the converted models on an unconnected
 * Sequelize and checks the shape the types describe.
 */
import { DataTypes, Sequelize } from "sequelize";
import defineKanbanCard from "../../models/kanbanCard.model";
import defineKanbanProject from "../../models/kanbanProject.model";
import defineWarehouse from "../../models/warehouse.model";
import defineStock from "../../models/stock.model";
import defineWorkflow from "../../models/workflow.model";
import defineAssetFinance from "../../models/assetFinance.model";
import defineNotificationState from "../../models/notificationState.model";
import {
  jsonShape,
  type NotificationChannels,
} from "../../utils/jsonShape.util";
import type { TenantId, UserId } from "../../types/ids";
import type {
  DefaultScoped,
  ModelInstance,
  Models,
  ModelsBarrel,
} from "../../types/models";

type IsDefaultScoped<S> = S extends { readonly defaultScoped: DefaultScoped }
  ? true
  : false;

// Compile-time assertions (never called).
export const typeChecks = async (
  models: Models,
  tenantId: TenantId,
  userId: UserId,
  raw: string,
): Promise<unknown[]> => {
  const { KanbanCard, KanbanProject, Warehouse, Stock } = models;

  // A tenant key takes a TenantId, not a raw string (negative check 5).
  await KanbanProject.create({ tenantId, name: "p" });
  // @ts-expect-error -- a raw string is not a TenantId
  await KanbanProject.create({ tenantId: raw, name: "p" });
  // @ts-expect-error -- a TenantId is not a UserId (the swap the brands exist to catch)
  await KanbanProject.create({ tenantId, name: "p", createdBy: tenantId });
  await KanbanProject.create({ tenantId, name: "p", createdBy: userId });

  // A required attribute is required on create; an optional one is not.
  // @ts-expect-error -- title is allowNull: false with no default
  await KanbanCard.create({ tenantId, projectId: raw, columnId: raw });
  await KanbanCard.create({
    tenantId,
    projectId: raw,
    columnId: raw,
    title: "t",
  });

  // The soft-delete ATTRIBUTE is isDeleted; is_deleted in values is refused (negative check 4).
  await Warehouse.update({ isDeleted: true }, { where: { id: raw } });
  // @ts-expect-error -- is_deleted is the column, not an attribute
  await Warehouse.update({ is_deleted: true }, { where: { id: raw } });

  // An ENUM attribute takes only its values (negative check 6).
  await Warehouse.update({ status: "inactive" }, { where: { id: raw } });
  // @ts-expect-error -- "broken" is not a warehouse status
  await Warehouse.update({ status: "broken" }, { where: { id: raw } });

  // An unknown attribute in a where is refused; an association is not an attribute.
  // @ts-expect-error -- no such attribute
  await Stock.findAll({ where: { itemNmae: "x" } });
  // @ts-expect-error -- warehouse is an association, not a column
  await Stock.findAll({ where: { warehouse: raw } });

  // Associations are typed through the Models map, as the included model.
  const stock = await Stock.findByPk(raw, {
    include: [{ model: Warehouse, as: "warehouse", required: false }],
  });
  const code: string | undefined = stock?.warehouse?.code;
  // @ts-expect-error -- quantity is a number
  const wrong: string | undefined = stock?.quantity;

  // The instance methods and statics are typed.
  const w: ModelInstance<"Warehouse"> | null = await Warehouse.findByPk(raw);
  await w?.softDelete();
  const [affected]: [number] = await Stock.restoreStatic(raw);
  // D-21: a DECIMAL attribute is the getter's number, so arithmetic is numeric (negative check 8).
  const invoice = await models.Invoice.findByPk(raw);
  const total: number | undefined = invoice
    ? invoice.amountDue + invoice.amountPaid
    : undefined;
  // @ts-expect-error -- a DECIMAL attribute is a number, not the driver's string
  const asText: string | undefined = invoice?.amountDue;

  return [code, wrong, affected, total, asText];
};

// D-27: the hand-written JSON type refuses what its Zod shape refuses (negative check 7).
export const channelsOk: NotificationChannels = ["email", "webhook"];
// @ts-expect-error -- "sms" is not a notification channel (the Zod shape refuses it too)
export const channelsBad: NotificationChannels = ["sms"];

// Session is snake_case, and typed so (P9-10 spec item 8, negative checks 1–3): the camelCase
// `tenantId` — the bug that broke the nightly retention purge — is a compile error in a where,
// in an update, and on an instance.
export const sessionChecks = async (
  models: Models,
  tenantId: TenantId,
): Promise<unknown> => {
  const { Session } = models;
  await Session.findAll({ where: { tenant_id: tenantId } });
  // @ts-expect-error -- `tenantId` is not a Session attribute (it is tenant_id)
  await Session.findAll({ where: { tenantId } });
  // @ts-expect-error -- `tenantId` is not a Session attribute (it is tenant_id)
  await Session.update({ tenantId }, { where: { tenant_id: tenantId } });
  const s = await Session.findOne();
  // @ts-expect-error -- TS2551: Property 'tenantId' does not exist on type 'Session'. Did you mean 'tenant_id'?
  return s?.tenantId;
};

// The barrel is typed: `db` is not a key (CLAUDE.md, the traps), and every model key is its class.
export const barrelChecks = (barrel: ModelsBarrel): unknown[] => {
  // @ts-expect-error -- the barrel exports `sequelize`, never `db`
  const wrong: unknown = barrel.db;
  const user: Models["User"] = barrel.User;
  const plural: Models["User"] = barrel.Users;
  return [wrong, user, plural, barrel.sequelize, barrel.Op];
};

// The D-12 brand: default-scoped models carry it, the others do not.
export const brandChecks: [
  IsDefaultScoped<Models["Warehouse"]>,
  IsDefaultScoped<Models["Stock"]>,
  IsDefaultScoped<Models["KanbanCard"]>,
] = [true, true, false];

describe("P9-10 — converted models: the shape the types describe", () => {
  it("D-27: the Zod shape accepts the value the type accepts and refuses the one it refuses", () => {
    const validate = jsonShape("UsageAlert.notificationChannels");
    expect(() => {
      validate(channelsOk);
    }).not.toThrow();
    expect(() => {
      validate(["sms"]);
    }).toThrow();
  });

  it("class variant: static members stay non-enumerable class members (Workflow.associate)", () => {
    const db = new Sequelize({ dialect: "postgres", logging: false });
    const Workflow = defineWorkflow(db);
    expect(Object.keys(Workflow)).not.toContain("associate");
    expect(
      Object.getOwnPropertyDescriptor(Workflow, "associate")?.enumerable,
    ).toBe(false);
    expect(Workflow.name).toBe("Workflow");
  });

  it("D-21: a DECIMAL getter returns a number, keeps null, and keeps undefined", () => {
    const db = new Sequelize({ dialect: "postgres", logging: false });
    const AssetFinance = defineAssetFinance(db, DataTypes);
    // What node-postgres delivers for a NUMERIC column, put in place as the driver would.
    const withRaw = (value: unknown): unknown => {
      const row = AssetFinance.build();
      Reflect.set(row.dataValues, "purchasePrice", value);
      return row.purchasePrice;
    };
    expect(withRaw("1250.50")).toBe(1250.5);
    expect(withRaw(null)).toBeNull();
    expect(AssetFinance.build().purchasePrice).toBeUndefined();
  });

  it("NotificationState keeps its own deletedAt column (per-user hide) and is not paranoid", () => {
    const db = new Sequelize({ dialect: "postgres", logging: false });
    const NotificationState = defineNotificationState(db);
    expect(NotificationState.options.paranoid).toBe(false);
    expect(NotificationState.getAttributes().deletedAt.allowNull).toBe(true);
  });

  it("each factory builds a fresh class bound to the Sequelize it is given (the tests' re-init relies on it)", () => {
    const a = new Sequelize({ dialect: "postgres", logging: false });
    const b = new Sequelize({ dialect: "postgres", logging: false });
    const onA = defineWarehouse(a, DataTypes);
    const onB = defineWarehouse(b, DataTypes);
    expect(onA).not.toBe(onB);
    expect(onA.sequelize).toBe(a);
    expect(onB.sequelize).toBe(b);
    expect(onA.name).toBe("Warehouse");
  });

  it("timestamps are Sequelize's own (allowNull: false), not re-declared in init (spec probe 1)", () => {
    const db = new Sequelize({ dialect: "postgres", logging: false });
    // Each read through its own model (a union of the two would not type-check the call).
    const card = defineKanbanCard(db, DataTypes).getAttributes();
    const project = defineKanbanProject(db, DataTypes).getAttributes();
    for (const attrs of [
      card.createdAt,
      card.updatedAt,
      project.createdAt,
      project.updatedAt,
    ]) {
      expect(attrs.allowNull).toBe(false);
    }
  });

  it("the default-scoped models keep the COLUMN key in their defaultScope (spec probe 3)", () => {
    const db = new Sequelize({ dialect: "postgres", logging: false });
    for (const define of [defineWarehouse, defineStock]) {
      const m = define(db, DataTypes);
      expect(m.options.defaultScope).toEqual({ where: { is_deleted: false } });
      // A-274: the unused includeDeleted scope is gone (only ApiKey keeps one).
      expect(m.options.scopes ?? {}).toEqual({});
    }
  });
});
