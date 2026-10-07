/**
 * P9-05 (MEMORY/specs/P9-05-shared-types.md) — every state machine's statuses are written ONCE,
 * in @callibrator/contracts/states, and every user of them is that list:
 *
 *  1. each model's `status` column is an ENUM of exactly the tuple, in its order (read from the
 *     model's real attribute definition — the order is what `sync` creates the type from);
 *  2. the contracts request schemas accept exactly the tuple's values;
 *  3. the backend constants and `Certificate.STATUS` ARE the contracts objects;
 *  4. no source file writes one of the lists out again (a copy would drift silently).
 */
import fs from "fs";
import path from "path";
import {
  CAPA_STATUSES,
  DEVICE_TYPE_STATUSES,
  INSPECTION_ITEM_DEFINITION_STATUSES,
  INSPECTION_TEMPLATE_STATUSES,
  TEMPLATE_PROPOSAL_STATUSES,
  TEMPLATE_VERSION_STATUSES,
  UPSTREAM_FILE_IMPORT_STATUSES,
  CERTIFICATE_STATE,
  CERTIFICATE_STATUSES,
  STOCK_OPNAME_STATUSES,
  STOCK_TRANSFER_STATUSES,
  TENANT_LIFECYCLE_STATE,
  TENANT_LIFECYCLE_STATUSES,
  WEBHOOK_DELIVERY_STATUSES,
  WORK_ORDER_STATUSES,
  WORKFLOW_INSTANCE_STATUSES,
} from "@callibrator/contracts/states";
import { CERTIFICATE_STATUS } from "@callibrator/contracts/certificate";
import { WORK_ORDER_STATUSES as CONTRACT_WORK_ORDER_STATUSES } from "@callibrator/contracts/maintenance";
import { updateOpnameStatusSchema, updateTransferStatusSchema } from "@callibrator/contracts/stock";
import { TENANT_STATUS } from "../../constants/tenantStatus";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real models barrel, read for its attribute definitions
const models = require("../../models") as unknown as Record<string, { getAttributes(): Record<string, { values?: readonly string[] }> } & { STATUS?: unknown }>;

const MACHINES: [model: string, tuple: readonly string[]][] = [
  ["Certificate", CERTIFICATE_STATUSES],
  ["StockTransfer", STOCK_TRANSFER_STATUSES],
  ["StockOpname", STOCK_OPNAME_STATUSES],
  ["Capa", CAPA_STATUSES],
  ["MaintenanceWorkOrder", WORK_ORDER_STATUSES],
  ["Tenant", TENANT_LIFECYCLE_STATUSES],
  ["WebhookDelivery", WEBHOOK_DELIVERY_STATUSES],
  ["WorkflowInstance", WORKFLOW_INSTANCE_STATUSES],
  // P20-01 / P20-03 (ADR-125 Am. 1): the inspection catalogue's lifecycles.
  ["DeviceType", DEVICE_TYPE_STATUSES],
  ["InspectionItemDefinition", INSPECTION_ITEM_DEFINITION_STATUSES],
  ["InspectionTemplate", INSPECTION_TEMPLATE_STATUSES],
  ["InspectionTemplateVersion", TEMPLATE_VERSION_STATUSES],
  ["InspectionTemplateProposal", TEMPLATE_PROPOSAL_STATUSES],
  // The rsync image import's lifecycle.
  ["UpstreamFileImport", UPSTREAM_FILE_IMPORT_STATUSES],
];

describe("P9-05 — state machines have one list each", () => {
  it.each(MACHINES)("%s.status is an ENUM of exactly the states.ts tuple, in order", (name, tuple) => {
    const model = models[name];
    expect(model).toBeDefined();
    expect(model?.getAttributes()["status"]?.values).toEqual([...tuple]);
  });

  it("the contracts request schemas accept exactly the tuple's values", () => {
    for (const [schema, tuple] of [
      [updateTransferStatusSchema, STOCK_TRANSFER_STATUSES],
      [updateOpnameStatusSchema, STOCK_OPNAME_STATUSES],
    ] as const) {
      for (const status of tuple) {
        expect(schema.safeParse({ status }).success).toBe(true);
      }
      expect(schema.safeParse({ status: "not-a-status" }).success).toBe(false);
    }
    expect(CERTIFICATE_STATUS).toBe(CERTIFICATE_STATUSES);
    expect(CONTRACT_WORK_ORDER_STATUSES).toBe(WORK_ORDER_STATUSES);
  });

  it("the backend's objects are the contracts objects", () => {
    expect(TENANT_STATUS).toBe(TENANT_LIFECYCLE_STATE);
    expect(models["Certificate"]?.STATUS).toBe(CERTIFICATE_STATE);
    expect(Object.values(CERTIFICATE_STATE)).toEqual([...CERTIFICATE_STATUSES]);
    expect(Object.values(TENANT_LIFECYCLE_STATE)).toEqual([...TENANT_LIFECYCLE_STATUSES]);
  });

  it("no source file writes one of the lists out again", () => {
    const REPO = path.resolve(__dirname, "../../../..");
    const roots = [path.join(REPO, "backend", "src"), path.join(REPO, "packages", "contracts", "src")];
    const files = roots.flatMap((root) =>
      (fs.readdirSync(root, { recursive: true }) as string[])
        .map((f) => path.join(root, f))
        .filter((f) => /\.(ts|js)$/.test(f) && !f.includes(`${path.sep}tests${path.sep}`) && !f.includes(`${path.sep}migrations${path.sep}`))
        .filter((f) => !f.endsWith(`${path.sep}states.ts`) && !f.endsWith(`${path.sep}qmsValues.ts`)),
    );
    const copies: string[] = [];
    for (const [name, tuple] of MACHINES) {
      // The list written out in order: "a", "b", "c" with any whitespace between.
      const literal = new RegExp(tuple.map((v) => `["']${v}["']`).join(String.raw`\s*,\s*`));
      for (const file of files) {
        if (literal.test(fs.readFileSync(file, "utf8"))) {
          copies.push(`${name}: ${path.relative(REPO, file)}`);
        }
      }
    }
    expect(copies).toEqual([]);
  });
});
