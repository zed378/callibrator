/**
 * P21-09d — who hears about a facility-scoped row (spec MEMORY/specs/P19-04-client-facilities.md
 * § 9.6; threat model AM-21, EP-15; G-21).
 *
 * A reminder about a device in F1 must never reach a user bound to F2. Today's reminders are a
 * tenant BROADCAST (a Notification with no `userId`): every unbound user of the tenant sees it, and
 * a bound user never does (Notification is FACILITY_READABLE by `userId` only, P21-09a). So the
 * audience of a facility row is:
 *
 *  - `broadcast: true` — the tenant broadcast, unchanged, for the unbound users (provider staff,
 *    self-served hospitals: a tenant with no bound user notices nothing, G-31);
 *  - `boundUserIds` — the active users BOUND TO THE ROW'S FACILITY whose effective permission
 *    (role ⊕ override, capped by the bound ceiling — the same function `dynamicAccess` reads)
 *    holds `read` on `menuSlug`, each addressed individually. Never another facility's users;
 *    never a facility named by the actor.
 *
 * ADR-124 Am. 6 § 4 records why unbound users stay on the broadcast instead of one addressed row
 * each. Named exports only.
 */
import type { Transaction } from "sequelize";
import models from "../models";
import { loadPermissionSources, allows } from "./effectivePermission.service";
import type { UserId } from "../types/ids";

/** The row fields the audience is derived from. */
export interface RecipientRow {
  readonly tenantId: string;
  readonly clientFacilityId?: string | null;
}

/** The audience of one row. */
export interface Recipients {
  /** The tenant broadcast (`userId` null) still goes out — it reaches unbound users only. */
  readonly broadcast: true;
  /** Bound users of the row's facility holding `read` on the menu, to address one by one. */
  readonly boundUserIds: string[];
}

interface BoundUserRow {
  id: string;
  roleId: string | null;
  clientFacilityId: string | null;
  role?: { id: string; name: string } | null;
}

/**
 * The audience of a notification about `row`.
 *
 * @param row - the row the notification is about (its tenant and facility, from the ROW)
 * @param menuSlug - the menu a recipient must hold read on (`calibration` for a device)
 * @param options - `{ transaction }`
 * @returns the broadcast flag and the bound recipients
 */
export const recipientsFor = async (
  row: RecipientRow,
  menuSlug: string,
  { transaction }: { transaction?: Transaction } = {},
): Promise<Recipients> => {
  if (!row.clientFacilityId) {
    return { broadcast: true, boundUserIds: [] };
  }
  const users = (await models.User.findAll({
    where: { tenantId: row.tenantId, clientFacilityId: row.clientFacilityId, isActive: true, status: "ACTIVE" },
    attributes: ["id", "roleId", "clientFacilityId"],
    include: [{ model: models.Role, as: "role", attributes: ["id", "name"], required: false }],
    order: [["id", "ASC"]],
    ...(transaction ? { transaction } : {}),
  })) as unknown as BoundUserRow[];
  const boundUserIds: string[] = [];
  for (const user of users) {
    const sources = await loadPermissionSources({
      id: user.id as UserId,
      role: user.role ?? null,
      clientFacilityId: user.clientFacilityId,
    });
    if (allows(sources, menuSlug, "read")) {
      boundUserIds.push(user.id);
    }
  }
  return { broadcast: true, boundUserIds };
};
