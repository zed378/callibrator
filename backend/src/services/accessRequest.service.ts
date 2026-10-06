/**
 * P10-05 / P10-07 / P10-15 (ADR-098 §6, §8.4, §8.6) — access requests: the
 * public intake, the super admin's queue, approval (which creates the tenant,
 * its first administrator and an invitation), rejection, the invitation's
 * re-issue, the retention sweep and the erasure of a requester's rows.
 *
 * Spec: MEMORY/specs/P10-05-request-access.md.
 *
 * TENANT ISOLATION. `access_requests` has no tenant column, deliberately (a
 * request precedes any tenant): the global hooks do not scope it, and it is
 * reached only by the public intake (a write) and by the super admin (the
 * admin router's `rbac(SUPER_ADMIN)`). Nothing tenant-owned is read here
 * except through `tenant.service#createTenant` and `user.service#assertIdentityFree`.
 *
 * PERSONAL DATA. The contact fields are personal data of a person who may
 * never hold an account. They are never written to an audit row's `changes`
 * (BR-P10-6: audit_logs is append-only, 0091) and never mailed to the
 * internal inbox (a mailbox is a weaker store than the database).
 */
import { createHash, randomBytes } from "crypto";
import { Op, type Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import emailQueue from "./emailQueue.service";
import userService from "./user.service";
import { AppError } from "../utils/appError.util";
import { logger } from "../middlewares/activityLog.middleware";
import { hashPassword } from "../utils/password.util";
import { configuredFrontendOrigin, emailLinkOrigin } from "../utils/publicLinkOrigin.util";
import { accessRequestIpPepper, accessRequestNotifyEmail } from "../config/publicAccess";
import { ROLE_IDS } from "../constants";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import {
  ACCESS_REQUEST_STATUSES,
  DECIDED_RETENTION_MONTHS,
  INVITATION_TTL_MS,
  PENDING_EXPIRY_DAYS,
  PER_EMAIL_DAILY_CAP,
  type AccessRequestStatus,
  type RequestLocale,
} from "../constants/accessRequest";
import type {
  ApproveAccessRequestInput,
  ListAccessRequestsInput,
  RejectAccessRequestInput,
  SubmitAccessRequestInput,
} from "../validators/accessRequest.validator";
import type { ModelInstance } from "../types/models";
import { toTenantId } from "../types/ids";

const { AccessRequest, User, Tenant } = models;

type AccessRequestRow = ModelInstance<"AccessRequest">;

/** Where a request came from, as the controller reads it (never the body). */
export interface RequestOrigin {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** The super admin acting, and the request's address (for the audit row). */
export interface Actor {
  readonly userId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** tenant.service.js#createTenant, as this module calls it (the module is JavaScript). */
interface TenantService {
  createTenant: (
    input: Record<string, unknown>,
    createdBy: string | null,
    actor: { ipAddress?: string | null; userAgent?: string | null },
    options: { transaction?: Transaction },
  ) => Promise<{ data: { id: string; code: string; name: string } & Record<string, unknown> }>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- tenant.service is JavaScript until Phase 9 converts it; typed by the one function used
const tenantService = require("./tenant.service") as TenantService;

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows the retention sweep expires or deletes per step and run. */
export const RETENTION_BATCH = 500;

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** `sha256(pepper + ip)`: the raw address is never stored. */
export const hashSourceIp = (ip: string | null): string => sha256(`${accessRequestIpPepper()}${ip ?? "unknown"}`);

/** A new invitation token (256 random bits, base64url) and the hash that is stored. */
export const newInvitationToken = (): { token: string; hash: string } => {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
};

/** The stored hash of a presented invitation token. */
export const invitationTokenHash = (token: string): string => sha256(token);

/** `months` calendar months before `now`. */
const monthsBefore = (now: Date, months: number): Date => {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
};

/** "Ada Lovelace" → { firstName: "Ada", lastName: "Lovelace" }; one word → the same twice. */
export const splitName = (fullName: string): { firstName: string; lastName: string } => {
  const parts = fullName.trim().split(/\s+/).filter((p) => p !== "");
  const firstName = (parts[0] ?? fullName.trim()).slice(0, 100);
  const rest = parts.slice(1).join(" ").slice(0, 100);
  return { firstName, lastName: rest === "" ? firstName : rest };
};

/** The tenant-administrator role for the facility: a calibration lab's admin role, else the healthcare admin's. */
const adminRoleFor = (facilityType: string): string =>
  facilityType === "calibration_lab" ? ROLE_IDS.CALIBRATOR_ADMIN : ROLE_IDS.HEALTCARE_ADMIN;

/** A username the users table accepts, from the local part of an address: letters and digits, 3–30. */
export const usernameBase = (email: string): string => {
  const local = email.split("@", 1).join("").toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = local.length >= 3 ? local : `${local}admin`;
  return base.slice(0, 24);
};

/** Whether a thrown value is user.service's identity-conflict 409. */
const isIdentityConflict = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { status?: unknown }).status === 409;

/** The date part of a timestamp, for a state explanation. */
const day = (value: Date | null): string => (value ? value.toISOString().slice(0, 10) : "an unknown date");

// --------------------------------------------------------------------------
// The public intake (P10-05)
// --------------------------------------------------------------------------

/** The one answer every submission gets (BR-P10-2). */
export const SUBMISSION_RECEIVED = Object.freeze({
  success: true,
  status: 202,
  message: "Request received",
  data: null,
});

/**
 * Store a request, with its audit row in the same transaction (A-41) — unless
 * the honeypot is filled or the address has asked `PER_EMAIL_DAILY_CAP` times
 * in 24 hours, in which case nothing is stored. The caller answers
 * SUBMISSION_RECEIVED in every case.
 *
 * @returns what happened, for the log and the tests — never for the response
 */
export const submitAccessRequest = async (
  input: SubmitAccessRequestInput,
  origin: RequestOrigin,
): Promise<"stored" | "honeypot" | "capped"> => {
  const sourceIpHash = hashSourceIp(origin.ip);

  // A bot filled the field no person sees. Storing it as `spam` would let a
  // bot fill the table; it is dropped, with the hashed address for review.
  if (input.website.trim() !== "") {
    logger.info("Access request dropped: honeypot", { sourceIpHash });
    return "honeypot";
  }

  // The per-address cap: the same indexed count whether or not the address has
  // asked before, so the latency does not separate the cases (no sleeps added).
  const recent = await AccessRequest.count({
    where: { workEmail: input.workEmail, createdAt: { [Op.gt]: new Date(Date.now() - DAY_MS) } },
  });
  if (recent >= PER_EMAIL_DAILY_CAP) {
    logger.info("Access request not stored: the address reached its daily cap", { sourceIpHash });
    return "capped";
  }

  const row = await db.transaction(async (transaction) => {
    const created = await AccessRequest.create(
      {
        organisationName: input.organisationName,
        facilityType: input.facilityType,
        city: input.city,
        deviceCountBand: input.deviceCountBand,
        contactName: input.contactName,
        contactRole: input.contactRole,
        workEmail: input.workEmail,
        whatsapp: input.whatsapp,
        needs: input.needs,
        locale: input.locale,
        consentVersion: input.consentVersion,
        consentedAt: new Date(),
        sourceIpHash,
        userAgent: origin.userAgent ? origin.userAgent.slice(0, 256) : null,
      },
      { transaction },
    );
    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
        systemActor: SYSTEM_ACTORS.ACCESS_REQUEST_INTAKE,
        action: "CREATE",
        resourceType: "AccessRequest",
        resourceId: created.id,
        // BR-P10-6: no name, address, phone or free text.
        changes: {
          after: { status: "pending", facilityType: input.facilityType, deviceCountBand: input.deviceCountBand },
        },
      },
      { transaction },
    );
    return created;
  });

  await notifyPlatform(row);
  return "stored";
};

/**
 * Tell the platform's inbox, after commit and best-effort: the organisation's
 * name and a link to the queue — never the requester's contact details. Unset
 * ACCESS_REQUEST_NOTIFY_EMAIL → nothing (the queue is the source of truth).
 */
const notifyPlatform = async (row: AccessRequestRow): Promise<void> => {
  const to = accessRequestNotifyEmail();
  if (to === null) {
    return;
  }
  const origin = configuredFrontendOrigin();
  try {
    await emailQueue.queueNotificationEmail({
      email: to,
      firstName: "Platform team",
      title: "New access request",
      message: `A new access request is waiting in the queue: ${row.organisationName}.`,
      actionUrl: origin === null ? null : `${origin}/dashboard/access-requests`,
    });
  } catch (err) {
    logger.warn("Access request notification not queued", { accessRequestId: row.id, error: (err as Error).message });
  }
};

// --------------------------------------------------------------------------
// The queue (P10-07)
// --------------------------------------------------------------------------

/** A request as the queue lists it. The invitation hash and the source hash never leave. */
export interface QueueRow {
  id: string;
  organisationName: string;
  facilityType: string;
  city: string;
  deviceCountBand: string;
  contactName: string;
  contactRole: string | null;
  workEmail: string;
  whatsapp: string;
  needs: string | null;
  locale: RequestLocale;
  status: AccessRequestStatus;
  createdAt: Date;
  decidedAt: Date | null;
  provisionedTenantId: string | null;
  duplicateCount: number;
}

const toQueueRow = (row: AccessRequestRow, duplicateCount: number): QueueRow => ({
  id: row.id,
  organisationName: row.organisationName,
  facilityType: row.facilityType,
  city: row.city,
  deviceCountBand: row.deviceCountBand,
  contactName: row.contactName,
  contactRole: row.contactRole,
  workEmail: row.workEmail,
  whatsapp: row.whatsapp,
  needs: row.needs,
  locale: row.locale,
  status: row.status,
  createdAt: row.createdAt,
  decidedAt: row.decidedAt,
  provisionedTenantId: row.provisionedTenantId,
  duplicateCount,
});

/** How many OTHER requests each address has, for the rows of one page. */
const duplicateCounts = async (rows: readonly AccessRequestRow[]): Promise<Map<string, number>> => {
  const emails = [...new Set(rows.map((r) => r.workEmail))];
  if (emails.length === 0) {
    return new Map();
  }
  // No tenant predicate: the table has none (see the module header).
  const all = await AccessRequest.findAll({ attributes: ["workEmail"], where: { workEmail: { [Op.in]: emails } } });
  const counts = new Map<string, number>();
  for (const r of all) {
    counts.set(r.workEmail, (counts.get(r.workEmail) ?? 0) + 1);
  }
  return counts;
};

/** The queue page: rows in `data`, pagination and the per-status counts in `meta`. */
export const listAccessRequests = async ({
  status,
  page,
  limit,
}: ListAccessRequestsInput): Promise<{
  rows: QueueRow[];
  meta: { total: number; page: number; limit: number; counts: Record<AccessRequestStatus, number> };
}> => {
  const { rows, count } = await AccessRequest.findAndCountAll({
    where: { status },
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });
  const dupes = await duplicateCounts(rows);
  const counts: Record<AccessRequestStatus, number> = { pending: 0, approved: 0, rejected: 0, spam: 0, expired: 0 };
  for (const s of ACCESS_REQUEST_STATUSES) {
    counts[s] = await AccessRequest.count({ where: { status: s } });
  }
  return {
    // Every address on the page is in `dupes` (it was counted from them).
    rows: rows.map((r) => toQueueRow(r, Number(dupes.get(r.workEmail)) - 1)),
    meta: { total: count, page, limit, counts },
  };
};

/** Load one request, or the 404 every missing id gets. */
const findOr404 = async (id: string, transaction?: Transaction): Promise<AccessRequestRow> => {
  const row = await AccessRequest.findByPk(
    id,
    transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {},
  );
  if (!row) {
    throw new AppError(404, "Access request not found");
  }
  return row;
};

/** The display name of a user, or null when the account is gone. */
const displayName = async (userId: string | null, transaction?: Transaction): Promise<string | null> => {
  if (!userId) {
    return null;
  }
  // `unscoped`: the decider may since have been soft-deleted — the name is history.
  const user = await User.unscoped().findByPk(userId, {
    attributes: ["id", "firstName", "lastName", "username"],
    ...(transaction ? { transaction } : {}),
  });
  return user ? `${user.firstName} ${user.lastName}`.trim() || user.username : null;
};

/** One request, with its decider, its tenant, its invitation state and the other requests from its address. */
export const getAccessRequest = async (id: string): Promise<Record<string, unknown>> => {
  const row = await findOr404(id);
  const tenant = row.provisionedTenantId
    ? await Tenant.findByPk(row.provisionedTenantId, { attributes: ["id", "code", "name"] })
    : null;
  const others = await AccessRequest.findAll({
    where: { workEmail: row.workEmail, id: { [Op.ne]: row.id } },
    attributes: ["id", "organisationName", "status", "createdAt"],
    order: [["createdAt", "DESC"]],
  });
  return {
    ...toQueueRow(row, others.length),
    decisionNote: row.decisionNote,
    decidedBy: row.decidedBy ? { id: row.decidedBy, name: await displayName(row.decidedBy) } : null,
    provisionedTenant: tenant ? { id: tenant.id, code: tenant.code, name: tenant.name } : null,
    adminUserId: row.adminUserId,
    invitation: {
      sentAt: row.invitationSentAt,
      expiresAt: row.invitationExpiresAt,
      acceptedAt: row.invitationAcceptedAt,
      // What the queue offers "Resend invitation" on.
      resendable: row.status === "approved" && row.adminUserId !== null && row.invitationAcceptedAt === null,
    },
    duplicates: others.map((o) => ({
      id: o.id,
      organisationName: o.organisationName,
      status: o.status,
      createdAt: o.createdAt,
    })),
  };
};

/** The 409 for a request that is not pending, as a state explanation (CLAUDE.md § Status Codes). */
const notPending = async (row: AccessRequestRow, transaction: Transaction): Promise<AppError> => {
  const who = await displayName(row.decidedBy, transaction);
  const verb = row.status === "spam" ? "marked as spam" : row.status;
  return new AppError(
    409,
    `This request was already ${verb} on ${day(row.decidedAt)}${who ? ` by ${who}` : ""}; only a pending request can be decided.`,
  );
};

// --------------------------------------------------------------------------
// Approval (P10-05 § Approve; Q-45)
// --------------------------------------------------------------------------

/** The message of the 409 an address already held by an account gets. */
export const ADDRESS_TAKEN =
  "An account with this address already exists — resolve it before approving (the request stays pending).";

/** A free username from the address's local part (letters and digits), tried in the transaction. */
const freeUsername = async (email: string, transaction: Transaction): Promise<string> => {
  const base = usernameBase(email);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}${String(randomBytes(2).readUInt16BE(0) % 10000)}`;
    try {
      await userService.assertIdentityFree("username", candidate, { transaction });
      return candidate;
    } catch (err) {
      if (!isIdentityConflict(err)) {
        throw err;
      }
    }
  }
  throw new AppError(409, "No free username could be derived from the request's address; resolve it before approving.");
};

/**
 * The first tenant administrator, in the approval's transaction (Q-45): the
 * request's address, NO usable password (a hash of random bytes nobody holds,
 * as ADR-051 Q-09's restored accounts), not yet verified. They set their own
 * password through the invitation (P10-15).
 */
const createFirstAdministrator = async (
  request: AccessRequestRow,
  tenantId: string,
  input: ApproveAccessRequestInput,
  actor: Actor,
  transaction: Transaction,
): Promise<ModelInstance<"User">> => {
  try {
    await userService.assertIdentityFree("email", request.workEmail, { transaction });
  } catch (err) {
    if (isIdentityConflict(err)) {
      // Only the super admin reaches this route, and a super admin can list
      // every account: this 409 discloses nothing it could not read, so it
      // is not held to A-128's per-administrator conflict budget.
      throw new AppError(409, ADDRESS_TAKEN);
    }
    throw err;
  }
  const names = splitName(request.contactName);
  const user = await User.create(
    {
      tenantId: toTenantId(tenantId),
      roleId: adminRoleFor(request.facilityType),
      email: request.workEmail,
      username: await freeUsername(request.workEmail, transaction),
      firstName: input.adminFirstName ?? names.firstName,
      lastName: input.adminLastName ?? names.lastName,
      password: await hashPassword(randomBytes(32).toString("hex")),
      isEmailVerified: false,
      isActive: true,
      status: "ACTIVE",
      mustChangePassword: false,
    },
    { transaction },
  );
  // Under the NEW tenant (A-41, ADR-051 Q-14): its history begins here.
  await auditService.logAction(
    {
      tenantId,
      userId: actor.userId,
      action: "CREATE",
      resourceType: "User",
      resourceId: user.id,
      changes: { operation: "ACCESS_REQUEST_FIRST_ADMINISTRATOR", accessRequestId: request.id, roleId: user.roleId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    },
    { transaction },
  );
  return user;
};

/** The invitation link, built on the configured public origin only (A-289). */
const invitationLink = (origin: string, token: string): string =>
  `${origin}/invitation?token=${encodeURIComponent(token)}`;

/** The invitation email, in the requester's language. No credential in it. */
const INVITATION_TEXT: Readonly<Record<RequestLocale, { title: string; message: (org: string) => string }>> = {
  id: {
    title: "Undangan ke Device Calibrator",
    message: (org) =>
      `Permintaan akses untuk ${org} telah disetujui. Buka tautan di bawah untuk membuat kata sandi Anda. ` +
      "Tautan berlaku 7 hari dan hanya dapat dipakai sekali.",
  },
  en: {
    title: "Your invitation to Device Calibrator",
    message: (org) =>
      `The access request for ${org} has been approved. Open the link below to set your password. ` +
      "The link is valid for 7 days and works once.",
  },
};

/**
 * Queue the invitation email; stamp `invitationSentAt` when it is queued. A
 * failure is logged, and the queue shows "Invitation not sent — resend".
 */
const sendInvitation = async (row: AccessRequestRow, origin: string, token: string): Promise<boolean> => {
  const text = INVITATION_TEXT[row.locale];
  try {
    const queued = await emailQueue.queueNotificationEmail({
      email: row.workEmail,
      firstName: splitName(row.contactName).firstName,
      title: text.title,
      message: text.message(row.organisationName),
      actionUrl: invitationLink(origin, token),
    });
    if (!queued) {
      throw new Error("the email queue refused the message");
    }
    await AccessRequest.update({ invitationSentAt: new Date() }, { where: { id: row.id } });
    return true;
  } catch (err) {
    logger.warn("Invitation email not queued", { accessRequestId: row.id, error: (err as Error).message });
    return false;
  }
};

/** What an approval answers — never the token. */
export interface ApprovalResult {
  request: QueueRow;
  tenant: Record<string, unknown>;
  adminUser: { id: string; email: string };
  invitationSent: boolean;
}

/**
 * Approve a pending request (P10-05 § Approve, steps 1–8): under a row lock,
 * create the tenant through `createTenant` (never a second path), its first
 * administrator and the invitation, mark the request approved, and write the
 * APPROVE row — one transaction; any 409 rolls all of it back and the request
 * stays pending. The invitation email goes out after commit.
 */
export const approveAccessRequest = async (
  id: string,
  input: ApproveAccessRequestInput,
  actor: Actor,
): Promise<ApprovalResult> => {
  // Before anything is written: in production an unset public origin refuses
  // here, rather than creating a tenant whose invitation cannot be sent.
  const origin = emailLinkOrigin();
  const invitation = newInvitationToken();

  const outcome = await db.transaction(async (transaction) => {
    // BR-P10-4: two super admins approving at once — the second waits here,
    // then finds the request approved and gets the 409.
    const row = await findOr404(id, transaction);
    if (row.status !== "pending") {
      throw await notPending(row, transaction);
    }

    const created = await tenantService.createTenant(
      {
        name: input.tenantName ?? row.organisationName.slice(0, 100),
        code: input.tenantCode,
        email: row.workEmail,
        city: row.city,
      },
      actor.userId,
      { ipAddress: actor.ipAddress, userAgent: actor.userAgent },
      { transaction },
    );
    const tenant = created.data;
    const admin = await createFirstAdministrator(row, tenant.id, input, actor, transaction);

    const now = new Date();
    await row.update(
      {
        status: "approved",
        decidedBy: actor.userId,
        decidedAt: now,
        provisionedTenantId: tenant.id,
        adminUserId: admin.id,
        invitationTokenHash: invitation.hash,
        invitationExpiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        invitationSentAt: null,
        invitationAcceptedAt: null,
      },
      { transaction },
    );
    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
        userId: actor.userId,
        action: "APPROVE",
        resourceType: "AccessRequest",
        resourceId: row.id,
        changes: {
          before: { status: "pending" },
          after: { status: "approved", provisionedTenantId: tenant.id, adminUserId: admin.id },
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
      { transaction },
    );
    return { row, tenant, admin };
  });

  const invitationSent = await sendInvitation(outcome.row, origin, invitation.token);
  return {
    request: toQueueRow(outcome.row, 0),
    tenant: outcome.tenant,
    adminUser: { id: outcome.admin.id, email: outcome.admin.email },
    invitationSent,
  };
};

/** Reject a pending request, or mark it spam. The reason is required (validator). */
export const rejectAccessRequest = async (
  id: string,
  input: RejectAccessRequestInput,
  actor: Actor,
): Promise<QueueRow> => {
  const status: AccessRequestStatus = input.spam ? "spam" : "rejected";
  const row = await db.transaction(async (transaction) => {
    const locked = await findOr404(id, transaction);
    if (locked.status !== "pending") {
      throw await notPending(locked, transaction);
    }
    await locked.update(
      { status, decidedBy: actor.userId, decidedAt: new Date(), decisionNote: input.reason },
      { transaction },
    );
    // UPDATE, not a new REJECT action: AUDIT_ACTIONS has none, and adding one
    // is an ENUM migration for nothing the row does not already record.
    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
        userId: actor.userId,
        action: "UPDATE",
        resourceType: "AccessRequest",
        resourceId: locked.id,
        changes: { before: { status: "pending" }, after: { status } },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
      { transaction },
    );
    return locked;
  });
  return toQueueRow(row, 0);
};

/**
 * Re-issue the invitation of an approved request whose administrator has not
 * accepted (P10-07, P10-15): a new token, the old one invalidated (its hash is
 * replaced), audited; the email goes out after commit.
 */
export const resendInvitation = async (id: string, actor: Actor): Promise<{ invitationSent: boolean; expiresAt: Date }> => {
  const origin = emailLinkOrigin();
  const invitation = newInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const row = await db.transaction(async (transaction) => {
    const locked = await findOr404(id, transaction);
    if (locked.status !== "approved" || locked.adminUserId === null) {
      throw new AppError(409, `This request is ${locked.status}; only an approved request has an invitation to resend.`);
    }
    if (locked.invitationAcceptedAt !== null) {
      throw new AppError(
        409,
        `The invitation was already accepted on ${day(locked.invitationAcceptedAt)}; the administrator signs in with their own password.`,
      );
    }
    await locked.update(
      { invitationTokenHash: invitation.hash, invitationExpiresAt: expiresAt, invitationSentAt: null },
      { transaction },
    );
    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
        userId: actor.userId,
        action: "UPDATE",
        resourceType: "AccessRequest",
        resourceId: locked.id,
        changes: { operation: "INVITATION_REISSUED", expiresAt: expiresAt.toISOString() },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
      { transaction },
    );
    return locked;
  });
  return { invitationSent: await sendInvitation(row, origin, invitation.token), expiresAt };
};

// --------------------------------------------------------------------------
// Retention (Q-42) and erasure (DSAR)
// --------------------------------------------------------------------------

/**
 * The retention sweep's part (run by dataRetention.service#runRetentionSweep):
 *  1. a `pending` request older than PENDING_EXPIRY_DAYS becomes `expired`
 *     (decided now, by nobody);
 *  2. `rejected`, `spam` and `expired` requests decided more than
 *     DECIDED_RETENTION_MONTHS ago are deleted outright.
 * An `approved` row keeps its link to the tenant it created. Each step and its
 * audit row (ids only) share a transaction.
 */
export const runAccessRequestRetention = async (now: Date = new Date()): Promise<{ expired: number; purged: number }> => {
  const expiredIds = await db.transaction(async (transaction) => {
    const due = await AccessRequest.findAll({
      attributes: ["id"],
      // Batched: a backlog larger than this is finished by the next nightly run.
      limit: RETENTION_BATCH,
      where: { status: "pending", createdAt: { [Op.lt]: new Date(now.getTime() - PENDING_EXPIRY_DAYS * DAY_MS) } },
      transaction,
    });
    const ids = due.map((r) => r.id);
    if (ids.length === 0) {
      return ids;
    }
    await AccessRequest.update({ status: "expired", decidedAt: now }, { where: { id: { [Op.in]: ids } }, transaction });
    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
        systemActor: SYSTEM_ACTORS.ACCESS_REQUEST_RETENTION,
        action: "UPDATE",
        resourceType: "AccessRequest",
        resourceId: null,
        changes: { operation: "ACCESS_REQUESTS_EXPIRED", after: { status: "expired" }, ids, count: ids.length },
      },
      { transaction },
    );
    return ids;
  });

  const purgedIds = await db.transaction(async (transaction) => {
    const due = await AccessRequest.findAll({
      attributes: ["id"],
      limit: RETENTION_BATCH,
      where: {
        status: { [Op.in]: ["rejected", "spam", "expired"] },
        decidedAt: { [Op.lt]: monthsBefore(now, DECIDED_RETENTION_MONTHS) },
      },
      transaction,
    });
    const ids = due.map((r) => r.id);
    if (ids.length === 0) {
      return ids;
    }
    await AccessRequest.destroy({ where: { id: { [Op.in]: ids } }, transaction });
    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
        systemActor: SYSTEM_ACTORS.ACCESS_REQUEST_RETENTION,
        action: "DELETE",
        resourceType: "AccessRequest",
        resourceId: null,
        changes: { operation: "ACCESS_REQUESTS_PURGED", ids, count: ids.length },
      },
      { transaction },
    );
    return ids;
  });

  return { expired: expiredIds.length, purged: purgedIds.length };
};

/** What an erased request's personal fields read afterwards. */
const ERASED = "[erased]";

/**
 * A requester's erasure request (DSAR, UU 27/2022 / GDPR Art. 17), found by
 * the address: a request that did not become a tenant is deleted; an approved
 * one keeps its tenant link with its personal fields replaced. The requester
 * may never have held an account, so this is keyed by the address, not a user.
 */
export const eraseAccessRequestsByEmail = async (
  email: string,
  actor: Actor,
): Promise<{ deleted: number; masked: number }> => {
  const address = email.trim().toLowerCase();
  return db.transaction(async (transaction) => {
    const rows = await AccessRequest.findAll({ where: { workEmail: address }, transaction, lock: transaction.LOCK.UPDATE });
    const approved = rows.filter((r) => r.status === "approved").map((r) => r.id);
    const other = rows.filter((r) => r.status !== "approved").map((r) => r.id);
    if (other.length > 0) {
      await AccessRequest.destroy({ where: { id: { [Op.in]: other } }, transaction });
    }
    for (const id of approved) {
      await AccessRequest.update(
        {
          contactName: ERASED,
          contactRole: null,
          workEmail: `erased-${id}@invalid`,
          whatsapp: "+0",
          needs: null,
          userAgent: null,
        },
        { where: { id }, transaction },
      );
    }
    if (rows.length > 0) {
      await auditService.logAction(
        {
          tenantId: PLATFORM_TENANT_ID,
          userId: actor.userId,
          action: "DELETE",
          resourceType: "AccessRequest",
          resourceId: null,
          changes: { operation: "ACCESS_REQUESTS_ERASED", deletedIds: other, maskedIds: approved },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        },
        { transaction },
      );
    }
    return { deleted: other.length, masked: approved.length };
  });
};
