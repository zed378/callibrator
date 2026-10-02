/**
 * Reports, `/api/v1/reports`.
 *
 * P9-18 (ADR-087): converted from reporting.controller.js, behaviour unchanged.
 * `req.user` is read without a guard (`auth` runs first), and the date bounds
 * are passed raw (the service coerces them). The service is read through its
 * module object at call time; `asyncHandler` and `success` are captured at
 * load, as the `.js` destructured them. `export =` keeps the exact object
 * `require()` returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import reportingService from "../services/reporting.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;

/** The principal `auth` set (read without a guard, as before). */
interface ReportPrincipal {
  tenantId: TenantId;
}

/** A report that may carry a tabular `csv` scaffold. */
interface CsvCapable {
  csv?: { headers: Parameters<typeof reportingService.toCsv>[0]; rows: readonly object[] } | null;
}

// Send a report as JSON, or as a CSV download when ?format=csv and the report
// exposes a tabular `csv` shape.
const respond = (req: Request, res: Response, result: CsvCapable, name: string): Response => {
  if (req.query["format"] === "csv" && result.csv) {
    const csv = reportingService.toCsv(result.csv.headers, result.csv.rows as Parameters<typeof reportingService.toCsv>[1]);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${name}.csv`);
    return res.status(200).send(csv);
  }
  // Strip the internal csv scaffold from JSON responses.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the scaffold is taken out of the answer
  const { csv, ...json } = result;
  return success(res, json, null, "Report generated", 200);
};

const summary = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportingService.getSummary((req.user as ReportPrincipal).tenantId);
  success(res, data, null, "Report generated", 200);
});

const compliance = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportingService.getCompliance((req.user as ReportPrincipal).tenantId, {
    from: req.query["from"] as string | undefined,
    to: req.query["to"] as string | undefined,
  });
  respond(req, res, data, "compliance_report");
});

const calibrationWorkload = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportingService.getCalibrationWorkload((req.user as ReportPrincipal).tenantId);
  success(res, data, null, "Report generated", 200);
});

const overdueDevices = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportingService.getOverdueDevices((req.user as ReportPrincipal).tenantId);
  respond(req, res, data, "overdue_devices");
});

const inventory = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportingService.getInventory((req.user as ReportPrincipal).tenantId);
  respond(req, res, data, "inventory_report");
});

const controller = { summary, compliance, calibrationWorkload, overdueDevices, inventory };

export = controller;
