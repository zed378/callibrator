/**
 * P21-09d — the one emitter for a facility-scoped row (spec MEMORY/specs/P19-04-client-facilities.md
 * § 9.1; threat model AM-20, F-6; G-19).
 *
 * A bound principal's socket never joins `tenant_<id>` (config/socket.ts): it joins
 * `facility_<tenantId>_<clientFacilityId>` and its user room. An event about a row therefore goes to
 * the tenant room (provider staff, self-served hospitals) and — when the row has a facility — to
 * THAT facility's room, the facility named from the ROW, never from the actor (a provider
 * technician's write in F1 reaches F1's users, not the technician's). tests/guards/
 * socketEmitters.facility.guard holds every emit in services/ to this helper or a user room.
 *
 * Best effort: never throws (a realtime hiccup must not fail the request that caused it).
 * Named exports only.
 */
import { logger } from "../middlewares/activityLog.middleware";

/** The row fields the rooms are named from. */
export interface RealtimeRow {
  readonly tenantId: string | null | undefined;
  readonly clientFacilityId?: string | null | undefined;
}

interface Emitter {
  to(room: string | string[]): { emit(event: string, payload?: unknown): unknown };
}

/** The rooms an event about `row` reaches: the tenant's, and the row's facility's when it has one. */
export const roomsForRow = (row: RealtimeRow): string[] => {
  if (!row.tenantId) {
    return [];
  }
  const rooms = [`tenant_${row.tenantId}`];
  if (row.clientFacilityId) {
    rooms.push(`facility_${row.tenantId}_${row.clientFacilityId}`);
  }
  return rooms;
};

/**
 * Emit `event` about `row` to its tenant room and its facility room.
 *
 * @param row - the row the event is about (its tenant and facility)
 * @param event - the event name
 * @param payload - what the clients receive; the caller keeps it free of other facilities' data
 */
export const emitForRow = (row: RealtimeRow, event: string, payload?: unknown): void => {
  const rooms = roomsForRow(row);
  if (rooms.length === 0) {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: the socket server loads after the services
    const { getIo } = require("../config/socket") as { getIo: () => Emitter };
    getIo().to(rooms).emit(event, payload);
  } catch (error) {
    logger.warn("Realtime: event not emitted", { event, error: String(error) });
  }
};
