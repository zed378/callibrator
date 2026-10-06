/**
 * The tenant's subscription and invoices, and the operator override of a
 * manually billed subscription (A-225).
 *
 * P9-17 (ADR-087, Stage C): converted from billing.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order: `STATUS_TRANSITIONS` sits between
 * `updateSubscription` and `fetchInvoices`, where the `.js` assigned it). `db`,
 * `Transaction`, the two models, `AppError`, `auditService`, the two audit
 * helpers and the two limits are captured once at load, as the `.js`
 * destructured them. No method calls a sibling.
 *
 * As built, not changed here: the catch blocks throw plain `{ status, message }`
 * objects, which the controller reads (the file-level `only-throw-error`
 * exemption below); `fetchInvoices` answers `data: { rows, count, meta }`, which
 * the controller unwraps.
 */
/* eslint-disable @typescript-eslint/only-throw-error -- as built (ADR-038 rule 3): the catch blocks throw { status, message } objects, which billing.controller and asyncHandler read */
import { Transaction as LoadedTransaction, type WhereOptions } from "sequelize";
import { db as loadedDb } from "../config";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT, MAX_LIMIT as LOADED_MAX_LIMIT } from "../constants";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const Transaction = LoadedTransaction;
const db = loadedDb;
const { Subscription, Invoice } = models;
const AppError = LoadedAppError;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const MAX_LIMIT = LOADED_MAX_LIMIT;

type SubscriptionRow = ModelInstance<"Subscription">;

/** The service's answer; the controller forwards it. */
interface ServiceResult<T> {
  success: true;
  status: number;
  message: string;
  data: T;
}

/** A row as `toJSON` gives it, or a plain copy of a value that has none. */
type PlainRecord = Record<string, unknown>;

/** A caught value, read for the two fields the thrown object carries. */
interface CaughtError {
  status?: unknown;
  message?: unknown;
}

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformRecord = (record: unknown): PlainRecord | null => {
  if (!record) {return null;}
  const r = record as { toJSON?: () => PlainRecord };
  return r.toJSON ? r.toJSON() : { ...(record as PlainRecord) };
};

// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy rows is an empty list (ADR-038 rule 3)
const transformRecords = (rows: unknown[] | null | undefined): (PlainRecord | null)[] => (rows || []).map(transformRecord);

// ------------------------------------------------------------------
// GET CURRENT SUBSCRIPTION
// ------------------------------------------------------------------
/**
 * A tenant's subscription. As built, the first read of a tenant with none
 * CREATES its basic subscription. P6-11 (2026-09-30): that create is a write,
 * so it commits with one audit row in its transaction, naming the reader who
 * caused it (`actor`, auditPrincipal(req)). A read of an existing
 * subscription writes nothing.
 */
const getSubscription = async (
  tenantId: TenantId,
  actor: AuditActorInput = {},
): Promise<ServiceResult<PlainRecord | null>> => {
  try {
    let subscription = await Subscription.findOne({
      where: { tenantId },
    });

    // Auto-create a free/basic subscription if one doesn't exist
    if (!subscription) {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      subscription = await db.transaction(async (transaction) => {
        const created = await Subscription.create(
          {
            tenantId,
            planId: "basic",
            status: "Active",
            billingCycle: "Monthly",
            currentPeriodStart: new Date(),
            currentPeriodEnd: thirtyDaysFromNow,
          },
          { transaction },
        );
        await auditService.logAction(
          {
            tenantId,
            ...auditEntryActor(actor),
            action: "CREATE",
            resourceType: "Subscription",
            // As built, a create that resolves nothing is tolerated (transformRecord maps it to null).
            resourceId: (created as { id?: string } | null)?.id ?? null,
            changes: {
              operation: "SUBSCRIPTION_DEFAULT_CREATE",
              after: { planId: "basic", status: "Active", billingCycle: "Monthly" },
              ...actorChanges(actor),
            },
          },
          { transaction },
        );
        return created;
      });
    }

    return {
      success: true,
      status: 200,
      message: "Subscription retrieved successfully",
      data: transformRecord(subscription),
    };
  } catch (error) {
    const e = error as CaughtError;
    throw {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 or "" status is 500 (ADR-038 rule 3)
      status: e.status || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back (ADR-038 rule 3)
      message: e.message || "Failed to retrieve subscription",
    };
  }
};

// ------------------------------------------------------------------
// UPDATE SUBSCRIPTION PLAN
// ------------------------------------------------------------------

/** The fields PATCH /billing/subscription may change. */
const OVERRIDABLE_FIELDS = Object.freeze(["planId", "billingCycle", "status"] as const);

type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

/**
 * A-225 — the subscription status transitions an operator may record by hand,
 * keyed by the current status. The shape follows the payment lifecycle the
 * Stripe webhooks drive (stripeWebhook.service): an active subscription falls
 * past due, a past-due one is settled, exhausted (unpaid) or cancelled; an
 * unpaid one is settled or cancelled; a cancelled one may be reactivated.
 * Skipping a stage (Active -> Unpaid) is not a payment event anyone recorded.
 */
const STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Active: Object.freeze(["PastDue", "Canceled"]),
  PastDue: Object.freeze(["Active", "Unpaid", "Canceled"]),
  Unpaid: Object.freeze(["Active", "Canceled"]),
  Canceled: Object.freeze(["Active"]),
});

const PROVIDER_MANAGED =
  "This subscription is billed through Stripe: its plan, billing cycle and status follow the payments " +
  "and are set by Stripe's webhooks. Change the plan in Stripe (checkout or the customer portal); an " +
  "override here would contradict what is being charged, and the next webhook would overwrite it.";

/** The validated override body (a JavaScript caller may pass anything in these fields). */
interface SubscriptionOverride {
  planId?: unknown;
  billingCycle?: unknown;
  status?: unknown;
  reason?: unknown;
}

/**
 * Change a subscription by hand — an operator override.
 *
 * A-225 — this set `status` and `planId` straight from the body: a caller
 * with billing update could mark an unpaid subscription Active, or move a
 * Stripe-billed tenant to another plan, with no payment and no record. Now:
 *  - a Stripe-billed subscription (`stripeSubscriptionId` set) refuses every
 *    change, 409: the provider is the source of truth, and its webhooks would
 *    overwrite the override anyway;
 *  - on a manually billed subscription, a status change must be a transition
 *    of STATUS_TRANSITIONS (else 409, the state explained) and must carry a
 *    `reason` (400 without one) — it records a payment event that happened
 *    outside the system;
 *  - the row is locked, and the change and ONE audit row (in the tenant's own
 *    trail, with before/after and the reason) commit together;
 *  - a field sent with its current value is not a change: the billing screen
 *    sends all three fields on every save, and an unchanged save writes
 *    nothing and no audit row.
 *
 * This does NOT change the tenant's own `status` (suspension) or `plan`
 * (feature gating): those have their own audited paths (tenant lifecycle,
 * tenant update), and the webhook's coupling of payment to suspension is for
 * Stripe-billed tenants only.
 *
 * @param tenantId - the caller's tenant (never from the body)
 * @param data - validated
 * @param actor - auditPrincipal(req)
 * @returns the envelope
 * @throws {{status: number, message: string}} 404 no subscription; 409
 *   provider-managed or an invalid transition; 400 a status change without a reason
 */
const updateSubscription = async (
  tenantId: TenantId,
  data: SubscriptionOverride,
  actor: AuditActorInput = {},
): Promise<ServiceResult<PlainRecord | null>> => {
  try {
    const { subscription, changed } = await db.transaction(async (transaction): Promise<{ subscription: SubscriptionRow; changed: boolean }> => {
      const locked = await Subscription.findOne({
        where: { tenantId },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });

      if (!locked) {
        throw new AppError(404, "Subscription not found for this tenant");
      }

      const changes: Partial<Record<OverridableField, unknown>> = {};
      for (const field of OVERRIDABLE_FIELDS) {
        if (data[field] !== undefined && data[field] !== locked[field]) {
          changes[field] = data[field];
        }
      }
      if (Object.keys(changes).length === 0) {
        return { subscription: locked, changed: false };
      }

      if (locked.stripeSubscriptionId) {
        throw new AppError(409, PROVIDER_MANAGED);
      }
      if (changes.status) {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a status outside the map has no transition (ADR-038 rule 3)
        const allowed = STATUS_TRANSITIONS[locked.status] || [];
        if (!allowed.includes(changes.status as string)) {
          throw new AppError(
            409,
            `This subscription is "${locked.status}" and cannot be set to "${changes.status as string}" by hand. ` +
              (allowed.length
                ? `From "${locked.status}" it can move to: ${allowed.join(", ")}.`
                : `No manual transition leaves "${locked.status}".`),
          );
        }
        if (!data.reason) {
          throw new AppError(
            400,
            "A status override records a payment event that happened outside the system: " +
              "send a `reason` (for example the invoice or bank reference).",
          );
        }
      }

      const before = Object.fromEntries(Object.keys(changes).map((field) => [field, locked[field as OverridableField]]));
      await locked.update(changes as Parameters<SubscriptionRow["update"]>[0], { transaction });
      await auditService.logAction(
        {
          tenantId,
          // A-282 (ADR-100): a key is system:api-key, its id in changes.
          ...auditEntryActor(actor),
          action: "UPDATE",
          resourceType: "Subscription",
          resourceId: locked.id,
          changes: {
            operation: "SUBSCRIPTION_OVERRIDE",
            before,
            after: changes,
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty reason is recorded as null (ADR-038 rule 3)
            reason: data.reason || null,
            ...actorChanges(actor),
          },
        },
        { transaction },
      );
      return { subscription: locked, changed: true };
    });

    return {
      success: true,
      status: 200,
      message: changed ? "Subscription updated successfully" : "Subscription unchanged",
      data: transformRecord(subscription),
    };
  } catch (error) {
    const e = error as CaughtError;
    throw {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 or "" status is 500 (ADR-038 rule 3)
      status: e.status || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back (ADR-038 rule 3)
      message: e.message || "Failed to update subscription",
    };
  }
};

// ------------------------------------------------------------------
// GET INVOICES
// ------------------------------------------------------------------

/** The list query as the controller passes it (validated; a JavaScript caller may pass anything). */
interface FetchInvoicesQuery {
  tenantId: TenantId;
  page?: number | string;
  limit?: number | string;
  status?: string | null;
}

interface InvoiceListData {
  rows: (PlainRecord | null)[];
  count: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const fetchInvoices = async ({
  tenantId,
  page = 1,
  limit = DEFAULT_LIMIT,
  status,
}: FetchInvoicesQuery): Promise<ServiceResult<InvoiceListData>> => {
  try {
    const whereClause: { tenantId: TenantId; status?: string } = { tenantId };

    if (status) {
      whereClause.status = status;
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    const { count, rows } = await Invoice.findAndCountAll({
      where: whereClause as WhereOptions,
      limit: safeLimit,
      offset,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      include: [
        { model: Subscription, as: "subscription", attributes: ["id", "planId"] },
      ],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch invoices successful",
      data: {
        rows: transformRecords(rows),
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: safeLimit,
          totalPages: Math.ceil(count / safeLimit),
        },
      },
    };
  } catch (error) {
    const e = error as CaughtError;
    throw {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 or "" status is 500 (ADR-038 rule 3)
      status: e.status || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message falls back (ADR-038 rule 3)
      message: e.message || "Failed to fetch invoices",
    };
  }
};

export = {
  getSubscription,
  updateSubscription,
  STATUS_TRANSITIONS,
  fetchInvoices,
};
