/**
 * P9-20/21 (ADR-097 Am. 5) — the response schemas published code-first for the
 * second slice of route modules. Each schema's own example (what `/docs`
 * shows) must be a value the schema accepts; an example the schema refuses is
 * documentation that contradicts itself.
 */
import { z } from "zod";
import { vendorResponse } from "@callibrator/contracts/vendor";
import { invoiceListItem, invoiceRow, stripeWebhookAck, stripeWebhookRefusal, subscriptionResponse } from "@callibrator/contracts/billing";
import { costEstimate, planDetails, tenantUsage, usageAlertResponse, usageAnalytics } from "@callibrator/contracts/meteredBilling";
import { assetFinanceResponse, assetFinanceWithRefs, depreciationReport } from "@callibrator/contracts/finance";
import { RISK_CATEGORIES, RISK_STATUSES, createRisk, riskResponse, riskWithPeople, updateRisk } from "@callibrator/contracts/risk";
import { SCORECARD_STATUSES, createScorecard, scorecardResponse, scorecardWithRefs, updateScorecard } from "@callibrator/contracts/supplierScorecard";

const exampleOf = (schema: z.ZodType): unknown => z.globalRegistry.get(schema)?.["example"];

describe("P9-20/21 response schemas accept their own examples", () => {
  it.each([
    ["Vendor", vendorResponse],
    ["Risk", riskResponse],
    ["SupplierScorecard", scorecardResponse],
    ["AssetFinance", assetFinanceResponse],
    ["DepreciationReport", depreciationReport],
    ["Subscription", subscriptionResponse],
    ["Invoice", invoiceListItem],
    ["InvoiceRow", invoiceRow],
    ["TenantUsage", tenantUsage],
    ["CostEstimate", costEstimate],
    ["PlanDetails", planDetails],
    ["UsageAlert", usageAlertResponse],
    ["UsageAnalytics", usageAnalytics],
  ])("%s", (_name, schema) => {
    const example = exampleOf(schema);
    expect(example).toBeDefined();
    expect(schema.safeParse(example).success).toBe(true);
  });

  it("a risk listed or fetched carries its people (null when there is none)", () => {
    const example = exampleOf(riskResponse) as Record<string, unknown>;
    expect(riskWithPeople.safeParse({ ...example, identifier: null, assignee: null }).success).toBe(true);
    expect(riskWithPeople.safeParse(example).success).toBe(false);
    expect(RISK_CATEGORIES).toContain(example["category"]);
    expect(RISK_STATUSES).toContain(example["status"]);
  });

  it("A-335: the risk bodies are an allow-list — server-owned fields are stripped, values are bounded", () => {
    const parsed = createRisk.parse({ title: " Alarm ", severity: "4", tenantId: "t", id: "i", identifiedBy: "u", status: "CLOSED", rpn: 1 });
    expect(parsed).toEqual({ title: "Alarm", severity: 4 });
    expect(createRisk.safeParse({ title: "x", severity: 6 }).success).toBe(false);
    expect(createRisk.safeParse({ title: "" }).success).toBe(false);
    expect(updateRisk.parse({ status: "MITIGATED", tenantId: "t" })).toEqual({ status: "MITIGATED" });
    expect(updateRisk.safeParse({ status: "DONE" }).success).toBe(false);
    expect(updateRisk.parse({})).toEqual({});
  });

  it("a scorecard listed or fetched carries its vendor and evaluator", () => {
    const example = exampleOf(scorecardResponse) as Record<string, unknown>;
    expect(scorecardWithRefs.safeParse({ ...example, vendor: { id: example["vendorId"], name: "Lab" }, evaluator: null }).success).toBe(true);
    expect(scorecardWithRefs.safeParse(example).success).toBe(false);
    expect(SCORECARD_STATUSES).toContain(example["status"]);
  });

  it("A-336: the scorecard bodies are an allow-list — server-owned fields are stripped, scores bounded", () => {
    const vendorId = "5f0c2a8e-7c1d-4b6a-9e2f-3d4c5b6a7e81";
    const parsed = createScorecard.parse({ vendorId, evaluationDate: "2026-09-30", qualityScore: "90", tenantId: "t", evaluatedBy: "u", id: "i" });
    expect(Object.keys(parsed).sort()).toEqual(["evaluationDate", "qualityScore", "vendorId"]);
    expect(parsed.qualityScore).toBe(90);
    expect(createScorecard.safeParse({ vendorId, evaluationDate: "2026-09-30", serviceScore: 101 }).success).toBe(false);
    expect(createScorecard.safeParse({ evaluationDate: "2026-09-30" }).success).toBe(false);
    expect(updateScorecard.parse({ status: "PROBATION", evaluatedBy: "u" })).toEqual({ status: "PROBATION" });
    expect(updateScorecard.safeParse({ status: "EXCELLENT" }).success).toBe(false);
  });

  it("a finance record listed or read carries its device and vendor; the figures are numbers (D-21)", () => {
    const example = exampleOf(assetFinanceResponse) as Record<string, unknown>;
    expect(assetFinanceWithRefs.safeParse({ ...example, device: null, vendor: null }).success).toBe(true);
    expect(assetFinanceResponse.safeParse({ ...example, purchasePrice: "120000.00" }).success).toBe(false);
  });

  it("the Stripe webhook answers in its own shapes, not the envelope", () => {
    expect(stripeWebhookAck.safeParse({ received: true, type: "invoice.paid", handled: true, subscriptionId: "s" }).success).toBe(true);
    expect(stripeWebhookRefusal.safeParse({ success: false, message: "Webhook Error: bad" }).success).toBe(true);
  });
});
