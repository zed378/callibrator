/** @jest-environment jsdom */
/**
 * Q-51 (ADR-100 Amendment 2) — a stock adjustment, a transfer request and a
 * calibration record written by an API key show "API key: <name>" where a
 * user's name shows today; a user-written row is unchanged; a row with
 * neither shows "-". Before, a key-written row showed "-" everywhere.
 */
import { render, screen } from "@testing-library/react";
import { actorLabel } from "./actorLabel";
import { AdjustmentsTable } from "@/app/(app)/dashboard/stock/components/AdjustmentsTable";
import { TransfersTable } from "@/app/(app)/dashboard/stock/components/TransfersTable";
import { CalibrationRecordsTable } from "@/app/(app)/dashboard/calibration/components/CalibrationRecordsTable";
import type { StockAdjustment, StockTransfer } from "@/types";
import type { Calibration } from "@/api/services/calibration.service";

const KEY = { id: "k1", name: "LIMS integration", keyPrefix: "cbk_1a2b3c" };
const USER = { id: "u1", username: "ana", firstName: "Ana", lastName: "Putri" };

describe("actorLabel", () => {
  it("a user's name, else the key, else null", () => {
    expect(actorLabel(USER, null)).toBe("Ana Putri");
    expect(actorLabel(USER, KEY)).toBe("Ana Putri");
    expect(actorLabel(null, KEY)).toBe("API key: LIMS integration");
    expect(actorLabel(undefined, undefined)).toBeNull();
    expect(actorLabel({ firstName: "", lastName: null }, null)).toBeNull();
  });
});

// A whole row as the contract publishes it (P9-25: the type is the contract's).
const adjustment = (over: Partial<StockAdjustment>): StockAdjustment => ({
  id: over.id ?? "a",
  tenantId: "t1",
  warehouseId: "w1",
  locationId: null,
  type: "addition",
  quantity: 1,
  reason: "count",
  stockId: null,
  quantityBefore: null,
  quantityAfter: null,
  adjustedBy: null,
  apiKeyId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

it("the adjustments list shows the key, the user, or '-'", () => {
  render(
    <AdjustmentsTable
      data={[
        adjustment({ id: "a1", apiKey: KEY }),
        adjustment({ id: "a2", adjustedBy: "u1", adjuster: USER }),
        adjustment({ id: "a3" }),
      ]}
    />,
  );
  expect(screen.getByText("API key: LIMS integration")).toBeInTheDocument();
  expect(screen.getByText("Ana Putri")).toBeInTheDocument();
  expect(screen.getAllByText("-").length).toBeGreaterThan(0);
});

it("the transfers list names the key as the requester", () => {
  const transfer: StockTransfer = {
    id: "t1",
    fromWarehouseId: "w1",
    toWarehouseId: "w2",
    status: "pending",
    requestedBy: null,
    itemName: "Fuse",
    quantity: 1,
    apiKey: KEY,
  } as StockTransfer;
  render(<TransfersTable data={[transfer]} hasWriteAccess={false} handleUpdateTransferStatus={() => undefined} />);
  expect(screen.getByText(/Req: API key: LIMS integration/)).toBeInTheDocument();
});

it("the calibration records list shows 'API key: <name>' in Performed By", () => {
  const record = {
    id: "r1",
    deviceId: "d1",
    performer: null,
    apiKey: KEY,
    device: { id: "d1", name: "Infusion pump", serialNumber: "SN", manufacturer: "M", model: "X" },
  } as unknown as Calibration;
  render(
    <CalibrationRecordsTable
      calibrations={{ success: true, data: [record], meta: { total: 1, page: 1, limit: 10, totalPages: 1 } }}
      isCalibLoading={false}
      pageSize={10}
      onPageChange={() => undefined}
      hasWriteAccess={false}
      openCreateCertificateModal={() => undefined}
    />,
  );
  expect(screen.getByText("API key: LIMS integration")).toBeInTheDocument();
});
