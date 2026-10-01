/**
 * Kanban fixtures shaped as the backend serialises them
 * (backend/src/services/kanban.service.js getProject / serializeCard /
 * serializeSprint), and the `success()` envelope the controller wraps them in:
 * the object in `data`, no `meta`.
 */
import type {
  AccessLevel,
  KanbanBoard,
  KanbanCard,
  KanbanSprint,
} from "@/api/services/kanban.service";

export const ok = <T,>(data: T, message = "ok") => ({
  success: true,
  status: 200,
  message,
  data,
});

export const kCard = (id: string, over: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  projectId: "proj-1",
  columnId: "col-todo",
  sprintId: null,
  number: 1,
  cardKey: `KB-${id}`,
  title: `Card ${id}`,
  description: null,
  position: 0,
  priority: null,
  dueDate: null,
  createdBy: "u-1",
  createdAt: "2026-09-20T08:00:00.000Z",
  updatedAt: "2026-09-20T08:00:00.000Z",
  assignees: [],
  labels: [],
  ...over,
});

export const kSprint = (id: string, over: Partial<KanbanSprint> = {}): KanbanSprint => ({
  id,
  name: `Sprint ${id}`,
  goal: null,
  status: "planned",
  startDate: null,
  endDate: null,
  position: 0,
  ...over,
});

export const kBoard = (
  myAccess: AccessLevel = "owner",
  over: Partial<KanbanBoard> = {},
): KanbanBoard => ({
  id: "proj-1",
  name: "Calibration rollout",
  code: "KB",
  description: "Ward 3 device rollout",
  color: "#4f46e5",
  createdBy: "u-1",
  myAccess,
  activeSprintId: "backlog",
  columns: [
    { id: "col-done", name: "Done", position: 2, wipLimit: null, isDone: true },
    { id: "col-todo", name: "To do", position: 0, wipLimit: null, isDone: false },
    { id: "col-doing", name: "Doing", position: 1, wipLimit: 2, isDone: false },
  ],
  cards: [
    kCard("c2", { position: 1, title: "Second" }),
    kCard("c1", { position: 0, title: "First" }),
    kCard("c3", { columnId: "col-doing", title: "In flight" }),
  ],
  labels: [{ id: "lab-1", name: "urgent-fix", color: "#ef4444" }],
  sprints: [kSprint("s1", { name: "Sprint 1", status: "active" })],
  members: [
    {
      id: "m-1",
      accessLevel: "owner",
      user: { id: "u-1", firstName: "Ana", lastName: "Owner", email: "ana@h.test" },
      role: null,
    },
    {
      id: "m-2",
      accessLevel: "viewer",
      user: null,
      role: { id: "r-tech", name: "Technician" },
    },
  ],
  ...over,
});

/** GET /api/v1/users/all — rows in `data`, pagination in a top-level `meta`. */
export const usersEnvelope = (
  users: { id: string; firstName?: string; lastName?: string; email: string }[],
) => ({
  success: true,
  status: 200,
  message: "Users retrieved",
  data: users.map((u) => ({ username: u.email.split("@")[0], ...u })),
  meta: { total: users.length, page: 1, limit: 100, totalPages: 1 },
});

/** GET /api/v1/roles — the house envelope, a top-level `meta` (F-19). */
export const rolesEnvelope = (roles: { id: string; name: string }[]) => ({
  success: true,
  message: "Roles retrieved",
  data: roles,
  meta: { page: 1, limit: 100, total: roles.length, totalPages: 1 },
});
