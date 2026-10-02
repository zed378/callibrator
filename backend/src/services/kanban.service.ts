/**
 * Kanban Service
 *
 * Project-tracker boards. One project === one board with its own columns,
 * cards, labels and membership. Enforces per-project access (owner/editor/
 * viewer, grantable by user OR role), emits realtime board updates, and
 * notifies assignees/watchers on card activity.
 *
 * P9-18 (ADR-087, Stage C): converted from kanban.service.js with no
 * behaviour change (its card_seq bump moved to sql() first, as its own
 * change). `export =` keeps the object `require()` returned (the same keys, in
 * the same order). createProject/updateProject and the member calls reach
 * getProject through that object, as the `.js` did through `exports`.
 * Everything the `.js` destructured is captured at load; notificationService
 * and auditService are read at call time; attachment.service stays a lazy
 * require (it is loaded at call time, as before).
 */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: `||` throughout this module treats every falsy value (empty strings, 0) as absent, and the conversion keeps that */
import { Op as LoadedOp } from "sequelize";
import type { CreationAttributes, Model, Transaction, WhereOptions } from "sequelize";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import socket from "../config/socket";
import notificationService from "./notification.service";
// The `.js` loaded the activity-log middleware here (it destructured an unused logger).
import "../middlewares/activityLog.middleware";
import auditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
} from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
// P9-18: the card_seq bump goes through the bind-only helper (P9-07): the
// project and its tenant are bound (D-05), never replacements.
import { sql as loadedSql } from "../utils/sql.util";
import type { SqlRunner } from "../utils/sql.util";
// N-01: the one super-admin predicate (utils/role.util.ts), both spellings.
import { isSuperAdmin as loadedIsSuperAdmin } from "../utils/role.util";
import type attachmentServiceType from "./attachment.service";
import type { ModelInstance } from "../types/models";

const Op = LoadedOp;
const {
  KanbanProject,
  KanbanProjectMember,
  KanbanColumn,
  KanbanCard,
  KanbanLabel,
  KanbanCardAssignee,
  KanbanCardLabel,
  KanbanSprint,
  KanbanCardRelation,
  User,
  Role,
} = models;
// The models export IS the Sequelize instance (Object.assign(db, {...})), so
// transactions come off `.sequelize` — there is no `db` key on it.
const sequelize = models.sequelize;
// The instance sql() sends through. A plain identifier, so the D-05 scan reads the call.
const dbRunner = sequelize as unknown as SqlRunner;
const AppError = LoadedAppError;
const { emitToBoard } = socket;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const sql = loadedSql;
const isSuperAdmin = loadedIsSuperAdmin;

type ProjectRow = ModelInstance<"KanbanProject">;
type MemberRow = ModelInstance<"KanbanProjectMember">;
type CardRow = ModelInstance<"KanbanCard">;
type SprintRow = ModelInstance<"KanbanSprint">;
type UserRow = ModelInstance<"User">;
type AccessLevel = "viewer" | "editor" | "owner";

/** The principal a kanban call acts for (req.user). */
interface KanbanUser {
  id: string;
  tenantId: string;
  role?: { id?: string | null; name?: string } | null;
  roleId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  isApiKey?: boolean;
}

interface MemberInput {
  userId?: string | null;
  roleId?: string | null;
  accessLevel?: string;
}
interface ProjectInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  code?: string | null;
  members?: MemberInput[];
  archived?: boolean;
}
interface ColumnInput {
  name?: string;
  wipLimit?: number | null;
  position?: number;
}
interface CardInput {
  columnId?: string;
  sprintId?: string | null;
  title?: string;
  description?: string | null;
  priority?: string | null;
  dueDate?: string | Date | null;
  assigneeIds?: string[];
  labelIds?: string[];
  [field: string]: unknown;
}
interface LabelInput {
  name?: string;
  color?: string | null;
}
interface SprintInput {
  name?: string;
  goal?: string | null;
  status?: string;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  position?: number;
  [field: string]: unknown;
}
interface MigrateInput {
  cardIds?: string[];
  allNotDone?: boolean;
  fromSprintId?: string | null;
  targetSprintId?: string | null;
}
interface RelationInput {
  targetCardId: string;
  type: string;
}

/** A card as the board renders it (assignees, labels and relations hydrated). */
type HydratedCard = CardRow & { relations?: unknown };
/** The association getters a card row carries at run time (belongsToMany mixins). */
interface CardMixins {
  getAssignees(options: Record<string, unknown>): Promise<UserRow[]>;
  getLabels(options: Record<string, unknown>): Promise<ModelInstance<"KanbanLabel">[]>;
}

/** The attachment service, loaded lazily where the `.js` required it. */
const attachmentService = (): typeof attachmentServiceType =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
  require("./attachment.service") as typeof attachmentServiceType;

/** Creation values as given (the validators shaped them), typed for the model's create. */
const asCreate = <M extends object>(values: Record<string, unknown>): CreationAttributes<ModelInstanceOf<M>> =>
  values as unknown as CreationAttributes<ModelInstanceOf<M>>;
/** Many creation values, as given. */
const asCreateMany = <M extends object>(values: Record<string, unknown>[]): CreationAttributes<ModelInstanceOf<M>>[] =>
  values as unknown as CreationAttributes<ModelInstanceOf<M>>[];
/** The model type a row type belongs to (identity: a row type is used as given). */
type ModelInstanceOf<M> = M extends Model ? M : never;

/** A typed view of an object-literal `where`, as the `.js` passed it. */
const whereOf = <M extends object>(where: Record<string | symbol, unknown>): WhereOptions<M> => where as WhereOptions<M>;

/**
 * P6-11 (A-41 addendum) — every board write commits with ONE audit row in its
 * transaction; a rolled-back write leaves none (logAction re-throws inside a
 * transaction). A project is always in its caller's tenant (resolveAccess
 * looks it up by `user.tenantId`), so the row is too. The actor is
 * auditPrincipal(req); a caller without one is named by `user` — the
 * principal the service already holds (a key as `system:api-key`, A-282).
 * Card descriptions are never recorded: they are free text, kept on the card.
 *
 * @param transaction
 * @param actor - auditPrincipal(req)
 * @param user - req.user
 * @param action
 * @param resourceType - KanbanProject, KanbanProjectMember, KanbanColumn, KanbanCard, KanbanLabel, KanbanSprint, KanbanCardRelation
 * @param resourceId
 * @param changes - { operation, projectId, before?, after? }
 */
const auditKanban = (
  transaction: Transaction,
  actor: AuditActorInput | null,
  user: KanbanUser,
  action: "CREATE" | "UPDATE" | "DELETE",
  resourceType: string,
  resourceId: string | null,
  changes: Record<string, unknown>,
): Promise<unknown> => {
  const who: AuditActorInput = actor || { userId: user.isApiKey ? null : user.id, apiKeyId: user.isApiKey ? user.id : null };
  return auditService.logAction(
    {
      tenantId: user.tenantId,
      ...auditEntryActor(who),
      action,
      resourceType,
      resourceId,
      changes: { ...changes, ...actorChanges(who) },
    },
    { transaction },
  );
};

/** The named attributes of a row, as plain values (null when absent). */
const pickFields = (row: object, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]));

// ------------------------------------------------------------------
// Access control
// ------------------------------------------------------------------

const LEVELS: Record<string, number> = { viewer: 1, editor: 2, owner: 3 };
// The last column is the terminal "Done" column: persistent (undeletable) and
// always kept last.
const DEFAULT_COLUMNS = [
  { name: "To Do", isDone: false },
  { name: "In Progress", isDone: false },
  { name: "Done", isDone: true },
];

// Valid card-relation types and their inverse (written in both directions so a
// card sees every relation without an OR query).
const RELATION_INVERSE: Record<string, string> = {
  relates_to: "relates_to",
  duplicates: "duplicates",
  blocks: "blocked_by",
  blocked_by: "blocks",
  parent_of: "child_of",
  child_of: "parent_of",
};

/**
 * Derive a card-key prefix from a project code or name.
 *
 * An explicit `code` is used VERBATIM: it is already capped at 12 chars by the
 * validator and the column, and truncating it here silently desynced the stored
 * code from the visible key (code "MGT4293476" produced keys "MGT42934-1").
 * Only the name-derived fallback is truncated, since names are free-form.
 */
const codePrefix = (project: { code?: string | null; name?: string | null }): string => {
  const fromCode = (project.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (fromCode) {return fromCode;}

  const fromName = (project.name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return fromName || "CARD";
};

const userRoleId = (user: KanbanUser | null | undefined): string | null => user?.role?.id || user?.roleId || null;

/**
 * Resolve a user's effective access level to a project, or null if none.
 * Super admins are treated as owners. Otherwise the highest level granted
 * either directly (by userId) or via their role (by roleId) wins.
 */
const resolveAccess = async (user: KanbanUser, projectId: string): Promise<{ project: ProjectRow; level: string | null }> => {
  const project = await KanbanProject.findOne({
    where: { id: projectId, tenantId: user.tenantId },
  });
  if (!project) {
    throw new AppError(404, "Project not found");
  }

  if (isSuperAdmin(user)) {
    return { project, level: "owner" };
  }

  // The creator is always an owner, even if the membership row is missing.
  if (project.createdBy && project.createdBy === user.id) {
    return { project, level: "owner" };
  }

  const rid = userRoleId(user);
  const members = await KanbanProjectMember.findAll({
    where: {
      projectId,
      [Op.or]: [
        { userId: user.id },
        ...(rid ? [{ roleId: rid }] : []),
      ],
    },
  });

  let best = 0;
  for (const m of members) {
    best = Math.max(best, LEVELS[m.accessLevel] || 0);
  }
  if (best === 0) {
    return { project, level: null };
  }
  // `best` is one of the LEVELS values, so a key always matches.
  const level = Object.keys(LEVELS).find((k) => LEVELS[k] === best) as string;
  return { project, level };
};

/**
 * Throw unless `user` has at least `minLevel` on `projectId`.
 * Returns the loaded project on success.
 */
const assertAccess = async (
  user: KanbanUser,
  projectId: string,
  minLevel: AccessLevel = "viewer",
): Promise<{ project: ProjectRow; level: string }> => {
  const { project, level } = await resolveAccess(user, projectId);
  if (!level || (LEVELS[level] as number) < (LEVELS[minLevel] as number)) {
    // 404 (not 403) for a viewer-level miss so we don't reveal the project
    // exists to someone with no access at all.
    if (!level) {throw new AppError(404, "Project not found");}
    throw new AppError(403, `Requires ${minLevel} access to this project`);
  }
  return { project, level };
};

/**
 * A-277 (ADR-094) — a user named in a body must be a user of the PROJECT's
 * tenant: a member granted access, or a card assignee. The ids were stored as
 * given, so another tenant's user joined as `null` (the A-75/ADR-048 shape)
 * and was notified in this tenant. Missing, soft-deleted and another
 * tenant's are one answer, 404 (the A-129 convention), so the check is no
 * oracle for which ids exist elsewhere. The tenant predicate is explicit: a
 * super admin's context skips the hooks.
 */
const USER_NOT_IN_TENANT = "User not found in this organisation";

const assertTenantUsers = async (tenantId: string, userIds: (string | null | undefined)[] | null | undefined): Promise<void> => {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) {return;}
  const found = await User.count({ where: whereOf<UserRow>({ id: { [Op.in]: ids }, tenantId }) });
  if (found !== ids.length) {
    throw new AppError(404, USER_NOT_IN_TENANT);
  }
};

// ------------------------------------------------------------------
// Serialization
// ------------------------------------------------------------------

const userBrief = (u: UserRow | null | undefined): { id: string; firstName: string | null; lastName: string | null; email: string } | null =>
  u
    ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }
    : null;

const serializeCard = (card: HydratedCard): Record<string, unknown> => ({
  id: card.id,
  projectId: card.projectId,
  columnId: card.columnId,
  sprintId: card.sprintId,
  number: card.number,
  cardKey: card.cardKey,
  title: card.title,
  description: card.description,
  position: card.position,
  priority: card.priority,
  dueDate: card.dueDate,
  createdBy: card.createdBy,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
  assignees: (card.assignees || []).map(userBrief),
  labels: (card.labels || []).map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
  })),
  // Present only when explicitly hydrated (single-card reads).
  relations: card.relations,
});

// required:false keeps these LEFT JOINs — otherwise a paranoid/scoped
// association turns the include into an INNER JOIN and silently drops cards
// that have no assignees or labels. (Same gotcha noted across this codebase.)
const cardInclude = (): Record<string, unknown>[] => [
  {
    model: User,
    as: "assignees",
    attributes: ["id", "firstName", "lastName", "email"],
    through: { attributes: [] },
    required: false,
  },
  {
    model: KanbanLabel,
    as: "labels",
    attributes: ["id", "name", "color"],
    through: { attributes: [] },
    required: false,
  },
];

/**
 * Hydrate a single card with its assignees + labels via association getters
 * rather than a JOIN, so an empty relation can never drop the row.
 */
const loadCard = async (id: string): Promise<HydratedCard | null> => {
  const card: HydratedCard | null = await KanbanCard.findByPk(id);
  if (!card) {return null;}
  const [assignees, labels, relations] = await Promise.all([
    (card as unknown as CardMixins).getAssignees({
      attributes: ["id", "firstName", "lastName", "email"],
      joinTableAttributes: [],
    }),
    (card as unknown as CardMixins).getLabels({
      attributes: ["id", "name", "color"],
      joinTableAttributes: [],
    }),
    loadRelations(id),
  ]);
  card.assignees = assignees;
  card.labels = labels;
  card.relations = relations;
  return card;
};

/** A card's outgoing relations, each with the linked card's key/title. */
const loadRelations = async (cardId: string): Promise<{ id: string; type: string; card: Record<string, unknown> | null }[]> => {
  const rows = await KanbanCardRelation.findAll({
    where: { sourceCardId: cardId },
    include: [
      {
        model: KanbanCard,
        as: "targetCard",
        attributes: ["id", "cardKey", "title", "columnId"],
        required: false,
      },
    ],
    order: [["createdAt", "ASC"]],
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    card: r.targetCard
      ? {
        id: r.targetCard.id,
        cardKey: r.targetCard.cardKey,
        title: r.targetCard.title,
        columnId: r.targetCard.columnId,
      }
      : null,
  }));
};

// ------------------------------------------------------------------
// Notifications (assignees + watchers)
// ------------------------------------------------------------------

/**
 * Notify a card's assignees (the watchers), skipping the actor who caused the
 * change. Best-effort — emitNotification already swallows its own failures.
 */
const notifyAssignees = async (card: HydratedCard, actorId: string, { title, message }: { title: string; message: string }): Promise<void> => {
  const targets = new Set<string>((card.assignees || []).map((u) => u.id));
  targets.delete(actorId);
  const actionUrl = `/dashboard/kanban/${card.projectId}?card=${card.id}`;
  await Promise.all(
    [...targets].map((userId) =>
      notificationService.emitNotification({
        tenantId: card.tenantId,
        userId,
        type: "SYSTEM", // notifications enum has no dedicated kanban type
        title,
        message,
        actionUrl,
      }),
    ),
  );
};

/** Notify specific users they were tagged/assigned to a card. */
const notifyTagged = async (card: HydratedCard, userIds: string[], actorId: string, actorName: string): Promise<void> => {
  const actionUrl = `/dashboard/kanban/${card.projectId}?card=${card.id}`;
  await Promise.all(
    userIds
      .filter((id) => id !== actorId)
      .map((userId) =>
        notificationService.emitNotification({
          tenantId: card.tenantId,
          userId,
          type: "SYSTEM", // notifications enum has no dedicated kanban type
          title: "You were assigned to a card",
          message: `${actorName} assigned you to "${card.title}"`,
          actionUrl,
        }),
      ),
  );
};

const actorName = (user: KanbanUser): string =>
  [user.firstName, user.lastName].filter(Boolean).join(" ") ||
  user.email ||
  "Someone";

// ------------------------------------------------------------------
// Projects
// ------------------------------------------------------------------

/** List every board the user can see in their tenant. */
const listProjects = async (user: KanbanUser): Promise<Record<string, unknown>[]> => {
  const where = { tenantId: user.tenantId, archivedAt: null };

  let projects: ProjectRow[];
  let memberships: MemberRow[] = [];
  if (isSuperAdmin(user)) {
    projects = await KanbanProject.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });
  } else {
    const rid = userRoleId(user);
    memberships = await KanbanProjectMember.findAll({
      where: whereOf<MemberRow>({
        [Op.or]: [{ userId: user.id }, ...(rid ? [{ roleId: rid }] : [])],
      }),
      attributes: ["projectId", "accessLevel"],
    });
    const ids = memberships.map((m) => m.projectId);
    projects = await KanbanProject.findAll({
      where: whereOf<ProjectRow>({
        ...where,
        [Op.or]: [{ id: { [Op.in]: ids } }, { createdBy: user.id }],
      }),
      order: [["createdAt", "DESC"]],
    });
  }

  // Attach a lightweight card count + the caller's own access level.
  //
  // P8-04 (ADR-096): ONE grouped count for every board, and the access level
  // from the memberships already read above — the same rule as resolveAccess
  // (super admin and creator are owners, else the best membership level).
  // This was a count plus resolveAccess (two or three queries) PER board: 122
  // queries for a user with 40 boards.
  const counts = (projects.length
    ? await KanbanCard.count({
      where: whereOf<CardRow>({ projectId: { [Op.in]: projects.map((p) => p.id) }, archivedAt: null }),
      group: ["projectId"],
    })
    : []) as unknown as { projectId: string; count: unknown }[];
  const cardCountOf = new Map(counts.map((c) => [c.projectId, Number(c.count)]));
  const bestOf = new Map<string, number>();
  for (const m of memberships) {
    bestOf.set(m.projectId, Math.max(bestOf.get(m.projectId) || 0, LEVELS[m.accessLevel] || 0));
  }
  const levelOf = (p: ProjectRow): string | null => {
    if (isSuperAdmin(user) || (p.createdBy && p.createdBy === user.id)) {
      return "owner";
    }
    const best = bestOf.get(p.id) || 0;
    return best === 0 ? null : (Object.keys(LEVELS).find((k) => LEVELS[k] === best) as string);
  };

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    cardCount: cardCountOf.get(p.id) || 0,
    myAccess: levelOf(p),
  }));
};

const createProject = async (user: KanbanUser, data: ProjectInput, actor: AuditActorInput | null = null): Promise<BoardView> => {
  const { name, description, color, code, members = [] } = data;

  const created = await sequelize.transaction(async (transaction) => {
    const project = await KanbanProject.create(
      asCreate<ProjectRow>({
        tenantId: user.tenantId,
        name,
        code: code ? code.toUpperCase() : null,
        description: description || null,
        color: color || null,
        createdBy: user.id,
      }),
      { transaction },
    );

    // Creator is the owner.
    await KanbanProjectMember.create(
      asCreate<MemberRow>({ projectId: project.id, userId: user.id, accessLevel: "owner" }),
      { transaction },
    );

    // Any extra members supplied at creation.
    for (const m of members) {
      await KanbanProjectMember.create(
        asCreate<MemberRow>({
          projectId: project.id,
          userId: m.userId || null,
          roleId: m.roleId || null,
          accessLevel: m.accessLevel || "viewer",
        }),
        { transaction },
      );
    }

    // Seed the default flow (last column is the terminal Done column).
    await KanbanColumn.bulkCreate(
      DEFAULT_COLUMNS.map((col, i) => ({
        projectId: project.id,
        name: col.name,
        position: i,
        isDone: col.isDone,
      })),
      { transaction },
    );

    // Seed an initial active sprint so the board has somewhere to show cards.
    await KanbanSprint.create(
      asCreate<SprintRow>({
        projectId: project.id,
        name: "Sprint 1",
        status: "active",
        position: 0,
      }),
      { transaction },
    );

    await auditKanban(transaction, actor, user, "CREATE", "KanbanProject", project.id, {
      operation: "KANBAN_PROJECT_CREATE",
      projectId: project.id,
      after: pickFields(project, PROJECT_FIELDS),
      members: members.map((m) => ({ userId: m.userId || null, roleId: m.roleId || null, accessLevel: m.accessLevel || "viewer" })),
    });
    return project;
  });

  return service.getProject(user, created.id);
};

/**
 * Full board: project + members + ordered columns + ordered cards.
 *
 * Cards are fetched for ONE sprint at a time (sprints keep boards small):
 *   options.sprintId = <uuid>   -> that sprint's cards
 *                    = "backlog" -> unassigned cards (sprintId null)
 *                    = "all"      -> every card
 *                    = undefined  -> the active sprint (fallback: backlog)
 * The resolved selection is returned as `activeSprintId`.
 */
const getProject = async (user: KanbanUser, projectId: string, options: { sprintId?: string | null | undefined } = {}): Promise<BoardView> => {
  const { project, level } = await assertAccess(user, projectId, "viewer");

  const sprints = await KanbanSprint.findAll({
    where: { projectId },
    order: [["position", "ASC"], ["createdAt", "ASC"]],
  });

  // Decide which sprint's cards to load.
  let sprintId: string | null | undefined = options.sprintId;
  if (sprintId === undefined) {
    const active = sprints.find((s) => s.status === "active");
    sprintId = active ? active.id : "backlog";
  }
  const cardWhere: Record<string, unknown> = { projectId, archivedAt: null };
  if (sprintId === "backlog") {
    cardWhere["sprintId"] = null;
  } else if (sprintId !== "all") {
    cardWhere["sprintId"] = sprintId;
  }

  const [columns, cards, labels, members] = await Promise.all([
    KanbanColumn.findAll({
      where: { projectId },
      order: [["position", "ASC"]],
    }),
    KanbanCard.findAll({
      where: whereOf<CardRow>(cardWhere),
      include: cardInclude(),
      order: [["position", "ASC"]],
    }),
    KanbanLabel.findAll({ where: { projectId }, order: [["name", "ASC"]] }),
    KanbanProjectMember.findAll({
      where: { projectId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false,
        },
        { model: Role, as: "role", attributes: ["id", "name"], required: false },
      ],
    }),
  ]);

  return {
    id: project.id,
    name: project.name,
    code: project.code,
    description: project.description,
    color: project.color,
    createdBy: project.createdBy,
    myAccess: level,
    activeSprintId: sprintId,
    columns: columns.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      wipLimit: c.wipLimit,
      isDone: c.isDone,
    })),
    cards: cards.map(serializeCard),
    labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    sprints: sprints.map(serializeSprint),
    members: members.map((m) => ({
      id: m.id,
      accessLevel: m.accessLevel,
      user: userBrief(m.user),
      role: m.role ? { id: m.role.id, name: m.role.name } : null,
    })),
  };
};

const serializeSprint = (s: SprintRow): Record<string, unknown> => ({
  id: s.id,
  name: s.name,
  goal: s.goal,
  status: s.status,
  startDate: s.startDate,
  endDate: s.endDate,
  position: s.position,
});

const PROJECT_FIELDS = ["name", "code", "description", "color", "archivedAt"];

/** A board, as getProject answers it. */
interface BoardView {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  color: string | null;
  createdBy: string | null;
  myAccess: string;
  activeSprintId: string | null;
  columns: Record<string, unknown>[];
  cards: Record<string, unknown>[];
  labels: Record<string, unknown>[];
  sprints: Record<string, unknown>[];
  members: Record<string, unknown>[];
}

const updateProject = async (user: KanbanUser, projectId: string, data: ProjectInput, actor: AuditActorInput | null = null): Promise<BoardView> => {
  const { project } = await assertAccess(user, projectId, "owner");
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) {patch["name"] = data.name;}
  if (data.code !== undefined) {
    patch["code"] = data.code ? data.code.toUpperCase() : null;
  }
  if (data.description !== undefined) {patch["description"] = data.description;}
  if (data.color !== undefined) {patch["color"] = data.color;}
  if (data.archived !== undefined) {
    patch["archivedAt"] = data.archived ? new Date() : null;
  }
  await sequelize.transaction(async (transaction) => {
    await KanbanProject.update(patch, { where: { id: projectId }, transaction });
    await auditKanban(transaction, actor, user, "UPDATE", "KanbanProject", projectId, {
      operation: "KANBAN_PROJECT_UPDATE",
      projectId,
      before: pickFields(project, Object.keys(patch)),
      after: patch,
    });
  });
  const result = await service.getProject(user, projectId);
  emitToBoard(projectId, "kanban:project:updated", { project: result });
  return result;
};

/** D-22 (ADR-083): cards read per page when a project's delete cascades. */
const PROJECT_DELETE_CARD_PAGE = 500;

const deleteProject = async (user: KanbanUser, projectId: string, actor: AuditActorInput | null = null): Promise<{ deleted: true }> => {
  const { project } = await assertAccess(user, projectId, "owner");
  // Paranoid destroy; children cascade at the DB level only on a hard delete.
  // D-22 (ADR-083): the project's cards stay (unreachable behind the deleted
  // project), but their FILES are soft-deleted with it, in one transaction,
  // one audit row each naming its card and, as `via`, the project. They used
  // to stay live — listed, counted and downloadable — and the orphan report
  // could not see them, because their cards were still live. Cards are read
  // by keyset, a page at a time.
  await sequelize.transaction(async (transaction) => {
    await KanbanProject.destroy({ where: { id: projectId }, transaction });
    await auditKanban(transaction, actor, user, "DELETE", "KanbanProject", projectId, {
      operation: "KANBAN_PROJECT_DELETE",
      projectId,
      before: pickFields(project, PROJECT_FIELDS),
    });
    let after: string | null = null;
    for (;;) {
      const cards: CardRow[] = await KanbanCard.findAll({
        where: whereOf<CardRow>({ projectId, ...(after ? { id: { [Op.gt]: after } } : {}) }),
        attributes: ["id"],
        order: [["id", "ASC"]],
        limit: PROJECT_DELETE_CARD_PAGE,
        transaction,
      });
      if (cards.length === 0) {
        break;
      }
      await attachmentService().softDeleteForResource(
        project.tenantId,
        "KanbanCard",
        cards.map((card) => card.id),
        { transaction, actor: { userId: user.id }, via: { type: "KanbanProject", id: projectId } },
      );
      if (cards.length < PROJECT_DELETE_CARD_PAGE) {
        break;
      }
      after = (cards[cards.length - 1] as CardRow).id;
    }
  });
  emitToBoard(projectId, "kanban:project:deleted", { projectId });
  return { deleted: true };
};

// ------------------------------------------------------------------
// Members
// ------------------------------------------------------------------

const addMember = async (user: KanbanUser, projectId: string, data: MemberInput, actor: AuditActorInput | null = null): Promise<{ memberId: string; members: unknown }> => {
  const { project } = await assertAccess(user, projectId, "owner");
  if (!data.userId && !data.roleId) {
    throw new AppError(400, "A userId or roleId is required");
  }
  // A-277: a member is a user of the project's tenant.
  await assertTenantUsers(project.tenantId, [data.userId]);
  const member = await sequelize.transaction(async (transaction) => {
    const created = await KanbanProjectMember.create(
      asCreate<MemberRow>({
        projectId,
        userId: data.userId || null,
        roleId: data.roleId || null,
        accessLevel: data.accessLevel || "viewer",
      }),
      { transaction },
    );
    await auditKanban(transaction, actor, user, "CREATE", "KanbanProjectMember", created.id, {
      operation: "KANBAN_MEMBER_ADD",
      projectId,
      after: pickFields(created, ["userId", "roleId", "accessLevel"]),
    });
    return created;
  });
  const result = await service.getProject(user, projectId);
  emitToBoard(projectId, "kanban:project:updated", { project: result });
  return { memberId: member.id, members: result.members };
};

const updateMember = async (user: KanbanUser, projectId: string, memberId: string, data: MemberInput, actor: AuditActorInput | null = null): Promise<unknown> => {
  await assertAccess(user, projectId, "owner");
  const member = await KanbanProjectMember.findOne({
    where: { id: memberId, projectId },
  });
  if (!member) {throw new AppError(404, "Member not found");}
  const before = member.accessLevel;
  await sequelize.transaction(async (transaction) => {
    const access: Record<string, unknown> = { accessLevel: data.accessLevel };
    await member.update(access, { transaction });
    await auditKanban(transaction, actor, user, "UPDATE", "KanbanProjectMember", member.id, {
      operation: "KANBAN_MEMBER_UPDATE",
      projectId,
      before: { accessLevel: before },
      after: { accessLevel: member.accessLevel },
    });
  });
  const result = await service.getProject(user, projectId);
  emitToBoard(projectId, "kanban:project:updated", { project: result });
  return result.members;
};

const removeMember = async (user: KanbanUser, projectId: string, memberId: string, actor: AuditActorInput | null = null): Promise<{ removed: true }> => {
  await assertAccess(user, projectId, "owner");
  const member = await KanbanProjectMember.findOne({
    where: { id: memberId, projectId },
  });
  if (!member) {throw new AppError(404, "Member not found");}
  // Never leave a board without an owner.
  if (member.accessLevel === "owner") {
    const owners = await KanbanProjectMember.count({
      where: { projectId, accessLevel: "owner" },
    });
    if (owners <= 1) {
      throw new AppError(400, "A project must keep at least one owner");
    }
  }
  await sequelize.transaction(async (transaction) => {
    await member.destroy({ transaction });
    await auditKanban(transaction, actor, user, "DELETE", "KanbanProjectMember", member.id, {
      operation: "KANBAN_MEMBER_REMOVE",
      projectId,
      before: pickFields(member, ["userId", "roleId", "accessLevel"]),
    });
  });
  const result = await service.getProject(user, projectId);
  emitToBoard(projectId, "kanban:project:updated", { project: result });
  return { removed: true };
};

// ------------------------------------------------------------------
// Columns (owner manages the flow)
// ------------------------------------------------------------------

const createColumn = async (user: KanbanUser, projectId: string, data: ColumnInput, actor: AuditActorInput | null = null): Promise<Record<string, unknown>> => {
  await assertAccess(user, projectId, "owner");
  // New columns land just before the terminal Done column, which must stay last.
  const column = await sequelize.transaction(async (transaction) => {
    const done = await KanbanColumn.findOne({
      where: { projectId, isDone: true },
      transaction,
    });
    const position = done
      ? done.position
      : await KanbanColumn.count({ where: { projectId }, transaction });
    if (done) {
      await done.update({ position: done.position + 1 }, { transaction });
    }
    const created = await KanbanColumn.create(
      asCreate<ModelInstance<"KanbanColumn">>({
        projectId,
        name: data.name,
        position,
        wipLimit: data.wipLimit ?? null,
        isDone: false,
      }),
      { transaction },
    );
    await auditKanban(transaction, actor, user, "CREATE", "KanbanColumn", created.id, {
      operation: "KANBAN_COLUMN_CREATE",
      projectId,
      after: pickFields(created, ["name", "position", "wipLimit", "isDone"]),
    });
    return created;
  });
  const payload = {
    id: column.id,
    name: column.name,
    position: column.position,
    wipLimit: column.wipLimit,
    isDone: column.isDone,
  };
  emitToBoard(projectId, "kanban:column:created", { column: payload });
  return payload;
};

const updateColumn = async (user: KanbanUser, projectId: string, columnId: string, data: ColumnInput, actor: AuditActorInput | null = null): Promise<Record<string, unknown>> => {
  await assertAccess(user, projectId, "owner");
  const column = await KanbanColumn.findOne({
    where: { id: columnId, projectId },
  });
  if (!column) {throw new AppError(404, "Column not found");}
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) {patch["name"] = data.name;}
  if (data.wipLimit !== undefined) {patch["wipLimit"] = data.wipLimit;}
  // Position is managed via reorderColumns (which keeps Done last); ignore any
  // direct position write on the Done column to avoid dislodging it.
  if (data.position !== undefined && !column.isDone) {
    patch["position"] = data.position;
  }
  const before = pickFields(column, ["name", "position", "wipLimit", "isDone"]);
  await sequelize.transaction(async (transaction) => {
    await column.update(patch, { transaction });
    await auditKanban(transaction, actor, user, "UPDATE", "KanbanColumn", column.id, {
      operation: "KANBAN_COLUMN_UPDATE",
      projectId,
      before,
      after: pickFields(column, ["name", "position", "wipLimit", "isDone"]),
    });
  });
  const payload = {
    id: column.id,
    name: column.name,
    position: column.position,
    wipLimit: column.wipLimit,
    isDone: column.isDone,
  };
  emitToBoard(projectId, "kanban:column:updated", { column: payload });
  return payload;
};

const deleteColumn = async (user: KanbanUser, projectId: string, columnId: string, actor: AuditActorInput | null = null): Promise<{ deleted: true }> => {
  await assertAccess(user, projectId, "owner");
  const column = await KanbanColumn.findOne({
    where: { id: columnId, projectId },
  });
  if (!column) {throw new AppError(404, "Column not found");}
  if (column.isDone) {
    throw new AppError(400, "The Done column cannot be deleted");
  }
  const remaining = await KanbanColumn.count({ where: { projectId } });
  if (remaining <= 1) {
    throw new AppError(400, "A project must keep at least one column");
  }
  await sequelize.transaction(async (transaction) => {
    await column.destroy({ transaction }); // cards cascade
    await auditKanban(transaction, actor, user, "DELETE", "KanbanColumn", column.id, {
      operation: "KANBAN_COLUMN_DELETE",
      projectId,
      before: pickFields(column, ["name", "position", "wipLimit", "isDone"]),
    });
  });
  emitToBoard(projectId, "kanban:column:deleted", { columnId });
  return { deleted: true };
};

const reorderColumns = async (user: KanbanUser, projectId: string, order: string[], actor: AuditActorInput | null = null): Promise<Record<string, unknown>[]> => {
  await assertAccess(user, projectId, "owner");
  await sequelize.transaction(async (transaction) => {
    const all = await KanbanColumn.findAll({
      where: { projectId },
      transaction,
    });
    const doneId = all.find((c) => c.isDone)?.id;
    // Apply the requested order but force the Done column to the very end,
    // regardless of where the client tried to place it.
    const seq = order.filter((id) => id !== doneId);
    if (doneId) {seq.push(doneId);}
    for (let i = 0; i < seq.length; i++) {
      await KanbanColumn.update(
        { position: i },
        { where: { id: seq[i] as string, projectId }, transaction },
      );
    }
    await auditKanban(transaction, actor, user, "UPDATE", "KanbanProject", projectId, {
      operation: "KANBAN_COLUMNS_REORDER",
      projectId,
      before: { order: [...all].sort((a, b) => a.position - b.position).map((c) => c.id) },
      after: { order: seq },
    });
  });
  const columns = await KanbanColumn.findAll({
    where: { projectId },
    order: [["position", "ASC"]],
  });
  const payload = columns.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    wipLimit: c.wipLimit,
    isDone: c.isDone,
  }));
  emitToBoard(projectId, "kanban:column:reordered", { columns: payload });
  return payload;
};

// ------------------------------------------------------------------
// Cards (editor)
// ------------------------------------------------------------------

const createCard = async (user: KanbanUser, projectId: string, data: CardInput, actor: AuditActorInput | null = null): Promise<Record<string, unknown>> => {
  const { project } = await assertAccess(user, projectId, "editor");
  // A-277: every assignee is a user of the project's tenant.
  await assertTenantUsers(project.tenantId, data.assigneeIds);

  const column = await KanbanColumn.findOne({
    where: { id: data.columnId, projectId },
  });
  if (!column) {throw new AppError(404, "Column not found");}

  // Resolve the target sprint: explicit value wins ("backlog"/null => backlog);
  // otherwise the card lands in the project's active sprint.
  let sprintId: string | null;
  if (data.sprintId === "backlog" || data.sprintId === null) {
    sprintId = null;
  } else if (data.sprintId) {
    const sprint = await KanbanSprint.findOne({
      where: { id: data.sprintId, projectId },
    });
    if (!sprint) {throw new AppError(404, "Sprint not found");}
    sprintId = sprint.id;
  } else {
    const active = await KanbanSprint.findOne({
      where: { projectId, status: "active" },
      order: [["position", "ASC"]],
    });
    sprintId = active ? active.id : null;
  }

  const card = await sequelize.transaction(async (transaction) => {
    const position = await KanbanCard.count({
      where: whereOf<CardRow>({ columnId: data.columnId, archivedAt: null }),
      transaction,
    });
    // Atomically claim the next per-project sequence number for the card key.
    // Raw SQL bypasses the tenant hooks, so the tenant predicate is explicit
    // (D-05): the project was resolved through the scoped model above, and
    // this statement must not be able to bump a counter in any other tenant.
    // `type: "SELECT"` (the helper's) answers the RETURNING rows directly.
    const rows = await sql<{ card_seq: number }>(
      dbRunner,
      `UPDATE kanban_projects SET card_seq = card_seq + 1, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING card_seq`,
      [projectId, project.tenantId],
      { transaction },
    );
    if (rows.length !== 1) {
      throw new AppError(404, "Project not found");
    }
    // Exactly one row (checked above).
    const number = (rows[0] as { card_seq: number }).card_seq;
    const cardKey = `${codePrefix(project)}-${String(number)}`;
    const created = await KanbanCard.create(
      asCreate<CardRow>({
        tenantId: project.tenantId,
        projectId,
        columnId: data.columnId,
        sprintId,
        number,
        cardKey,
        title: data.title,
        description: data.description || null,
        priority: data.priority || null,
        dueDate: data.dueDate || null,
        position,
        createdBy: user.id,
      }),
      { transaction },
    );

    if (data.assigneeIds?.length) {
      await KanbanCardAssignee.bulkCreate(
        asCreateMany<ModelInstance<"KanbanCardAssignee">>(data.assigneeIds.map((userId) => ({ cardId: created.id, userId }))),
        { transaction, ignoreDuplicates: true },
      );
    }
    if (data.labelIds?.length) {
      // Explicit join inserts rather than the setLabels mixin, which trips on
      // this through-model's shape (matches how assignees are handled above).
      await KanbanCardLabel.bulkCreate(
        asCreateMany<ModelInstance<"KanbanCardLabel">>(data.labelIds.map((labelId) => ({ cardId: created.id, labelId }))),
        { transaction, ignoreDuplicates: true },
      );
    }
    await auditKanban(transaction, actor, user, "CREATE", "KanbanCard", created.id, {
      operation: "KANBAN_CARD_CREATE",
      projectId,
      cardKey,
      after: { ...pickFields(created, ["title", "priority", "dueDate", "columnId", "sprintId", "position"]), assigneeIds: data.assigneeIds || [], labelIds: data.labelIds || [] },
    });
    return created;
  });

  // The card just written exists (as built, a null would throw below).
  const full = (await loadCard(card.id)) as HydratedCard;
  emitToBoard(projectId, "kanban:card:created", { card: serializeCard(full) });

  // Assigning a user is the tagging event -> notify them.
  if (data.assigneeIds?.length) {
    await notifyTagged(full, data.assigneeIds, user.id, actorName(user));
  }
  return serializeCard(full);
};

const updateCard = async (user: KanbanUser, projectId: string, cardId: string, data: CardInput, actor: AuditActorInput | null = null): Promise<Record<string, unknown>> => {
  const { project } = await assertAccess(user, projectId, "editor");
  // A-277: every assignee is a user of the project's tenant.
  await assertTenantUsers(project.tenantId, data.assigneeIds);
  const card = await KanbanCard.findOne({
    where: { id: cardId, projectId },
    include: cardInclude(),
  });
  if (!card) {throw new AppError(404, "Card not found");}

  const previousAssignees = new Set<string>((card.assignees || []).map((u) => u.id));
  const before = {
    ...pickFields(card, ["title", "priority", "dueDate", "columnId", "sprintId", "position"]),
    assigneeIds: [...previousAssignees],
    labelIds: (card.labels || []).map((l) => l.id),
  };

  await sequelize.transaction(async (transaction) => {
    const patch: Record<string, unknown> = {};
    for (const f of ["title", "description", "priority", "dueDate"]) {
      if (data[f] !== undefined) {patch[f] = data[f];}
    }
    if (data.sprintId !== undefined) {
      patch["sprintId"] =
        data.sprintId === "backlog" || data.sprintId === null
          ? null
          : data.sprintId;
    }
    if (Object.keys(patch).length) {
      await card.update(patch, { transaction });
    }
    if (data.assigneeIds !== undefined) {
      await KanbanCardAssignee.destroy({
        where: { cardId },
        transaction,
      });
      if (data.assigneeIds.length) {
        await KanbanCardAssignee.bulkCreate(
          asCreateMany<ModelInstance<"KanbanCardAssignee">>(data.assigneeIds.map((userId) => ({ cardId, userId }))),
          { transaction, ignoreDuplicates: true },
        );
      }
    }
    if (data.labelIds !== undefined) {
      await KanbanCardLabel.destroy({ where: { cardId }, transaction });
      if (data.labelIds.length) {
        await KanbanCardLabel.bulkCreate(
          asCreateMany<ModelInstance<"KanbanCardLabel">>(data.labelIds.map((labelId) => ({ cardId, labelId }))),
          { transaction, ignoreDuplicates: true },
        );
      }
    }
    await auditKanban(transaction, actor, user, "UPDATE", "KanbanCard", cardId, {
      operation: "KANBAN_CARD_UPDATE",
      projectId,
      cardKey: card.cardKey,
      before,
      after: {
        ...pickFields(card, ["title", "priority", "dueDate", "columnId", "sprintId", "position"]),
        assigneeIds: data.assigneeIds !== undefined ? data.assigneeIds : before.assigneeIds,
        labelIds: data.labelIds !== undefined ? data.labelIds : before.labelIds,
      },
      descriptionChanged: data.description !== undefined,
    });
  });

  // The card just written exists (as built, a null would throw below).
  const full = (await loadCard(cardId)) as HydratedCard;
  emitToBoard(projectId, "kanban:card:updated", { card: serializeCard(full) });

  // Notify existing watchers about the edit.
  await notifyAssignees(full, user.id, {
    title: "A card you follow was updated",
    message: `${actorName(user)} updated "${full.title}"`,
  });
  // Notify anyone newly tagged.
  if (data.assigneeIds !== undefined) {
    const added = data.assigneeIds.filter((id) => !previousAssignees.has(id));
    if (added.length) {
      await notifyTagged(full, added, user.id, actorName(user));
    }
  }
  return serializeCard(full);
};

const moveCard = async (
  user: KanbanUser,
  projectId: string,
  cardId: string,
  { columnId, position }: { columnId: string; position: number },
  actor: AuditActorInput | null = null,
): Promise<Record<string, unknown>> => {
  await assertAccess(user, projectId, "editor");
  const card = await KanbanCard.findOne({ where: { id: cardId, projectId } });
  if (!card) {throw new AppError(404, "Card not found");}
  const destColumn = await KanbanColumn.findOne({
    where: { id: columnId, projectId },
  });
  if (!destColumn) {throw new AppError(404, "Destination column not found");}

  const fromColumn = card.columnId;
  const fromPosition = card.position;

  await sequelize.transaction(async (transaction) => {
    // Detach the card, then renumber destination with it inserted at `position`.
    card.columnId = columnId;
    await card.save({ transaction });

    const renumber = async (colId: string): Promise<void> => {
      const siblings = await KanbanCard.findAll({
        where: whereOf<CardRow>({ columnId: colId, archivedAt: null }),
        order: [["position", "ASC"]],
        transaction,
      });
      const ordered = siblings.filter((c) => c.id !== cardId);
      if (colId === columnId) {
        const idx = Math.min(Math.max(position, 0), ordered.length);
        ordered.splice(idx, 0, card);
      }
      for (let i = 0; i < ordered.length; i++) {
        const row = ordered[i] as CardRow;
        if (row.position !== i) {
          await KanbanCard.update(
            { position: i },
            { where: { id: row.id }, transaction },
          );
        }
      }
    };

    await renumber(columnId);
    if (fromColumn !== columnId) {
      await renumber(fromColumn);
    }
    await auditKanban(transaction, actor, user, "UPDATE", "KanbanCard", cardId, {
      operation: "KANBAN_CARD_MOVE",
      projectId,
      cardKey: card.cardKey,
      before: { columnId: fromColumn, position: fromPosition },
      after: { columnId, position },
    });
  });

  // The card just written exists (as built, a null would throw below).
  const full = (await loadCard(cardId)) as HydratedCard;
  emitToBoard(projectId, "kanban:card:moved", {
    card: serializeCard(full),
    fromColumn,
    toColumn: columnId,
  });

  if (fromColumn !== columnId) {
    await notifyAssignees(full, user.id, {
      title: "A card you follow moved",
      message: `${actorName(user)} moved "${full.title}" to ${destColumn.name}`,
    });
  }
  return serializeCard(full);
};

const deleteCard = async (user: KanbanUser, projectId: string, cardId: string, actor: AuditActorInput | null = null): Promise<{ deleted: true }> => {
  await assertAccess(user, projectId, "editor");
  const card = await KanbanCard.findOne({ where: { id: cardId, projectId } });
  if (!card) {throw new AppError(404, "Card not found");}
  // D-22 (ADR-070): the card's attachments are soft-deleted with it, in one
  // transaction, each with its audit row.
  await sequelize.transaction(async (transaction) => {
    await card.destroy({ transaction });
    await auditKanban(transaction, actor, user, "DELETE", "KanbanCard", card.id, {
      operation: "KANBAN_CARD_DELETE",
      projectId,
      cardKey: card.cardKey,
      before: pickFields(card, ["title", "priority", "dueDate", "columnId", "sprintId", "position"]),
    });
    await attachmentService().softDeleteForResource(
      card.tenantId,
      "KanbanCard",
      card.id,
      { transaction, actor: { userId: user.id } },
    );
  });
  emitToBoard(projectId, "kanban:card:deleted", { cardId, columnId: card.columnId });
  return { deleted: true };
};

// ------------------------------------------------------------------
// Labels (editor manages the tag palette)
// ------------------------------------------------------------------

const createLabel = async (user: KanbanUser, projectId: string, data: LabelInput, actor: AuditActorInput | null = null): Promise<Record<string, unknown>> => {
  await assertAccess(user, projectId, "editor");
  const label = await sequelize.transaction(async (transaction) => {
    const created = await KanbanLabel.create(
      asCreate<ModelInstance<"KanbanLabel">>({
        projectId,
        name: data.name,
        color: data.color || null,
      }),
      { transaction },
    );
    await auditKanban(transaction, actor, user, "CREATE", "KanbanLabel", created.id, {
      operation: "KANBAN_LABEL_CREATE",
      projectId,
      after: pickFields(created, ["name", "color"]),
    });
    return created;
  });
  const payload = { id: label.id, name: label.name, color: label.color };
  emitToBoard(projectId, "kanban:label:created", { label: payload });
  return payload;
};

const updateLabel = async (user: KanbanUser, projectId: string, labelId: string, data: LabelInput, actor: AuditActorInput | null = null): Promise<Record<string, unknown>> => {
  await assertAccess(user, projectId, "editor");
  const label = await KanbanLabel.findOne({
    where: { id: labelId, projectId },
  });
  if (!label) {throw new AppError(404, "Label not found");}
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) {patch["name"] = data.name;}
  if (data.color !== undefined) {patch["color"] = data.color;}
  const before = pickFields(label, ["name", "color"]);
  await sequelize.transaction(async (transaction) => {
    await label.update(patch, { transaction });
    await auditKanban(transaction, actor, user, "UPDATE", "KanbanLabel", label.id, {
      operation: "KANBAN_LABEL_UPDATE",
      projectId,
      before,
      after: pickFields(label, ["name", "color"]),
    });
  });
  const payload = { id: label.id, name: label.name, color: label.color };
  emitToBoard(projectId, "kanban:label:updated", { label: payload });
  return payload;
};

const deleteLabel = async (user: KanbanUser, projectId: string, labelId: string, actor: AuditActorInput | null = null): Promise<{ deleted: true }> => {
  await assertAccess(user, projectId, "editor");
  const label = await KanbanLabel.findOne({
    where: { id: labelId, projectId },
  });
  if (!label) {throw new AppError(404, "Label not found");}
  await sequelize.transaction(async (transaction) => {
    await label.destroy({ transaction }); // card_label join rows cascade
    await auditKanban(transaction, actor, user, "DELETE", "KanbanLabel", label.id, {
      operation: "KANBAN_LABEL_DELETE",
      projectId,
      before: pickFields(label, ["name", "color"]),
    });
  });
  emitToBoard(projectId, "kanban:label:deleted", { labelId });
  return { deleted: true };
};

// ------------------------------------------------------------------
// Sprints (owner manages; keep boards small by scoping cards to a sprint)
// ------------------------------------------------------------------

const listSprints = async (user: KanbanUser, projectId: string): Promise<{ sprints: Record<string, unknown>[]; backlogCount: number }> => {
  await assertAccess(user, projectId, "viewer");
  const sprints = await KanbanSprint.findAll({
    where: { projectId },
    order: [["position", "ASC"], ["createdAt", "ASC"]],
  });
  // Attach a card count per sprint (plus backlog) for the sprint picker.
  // P8-04 (ADR-096): one count grouped by sprint (the NULL group is the
  // backlog) instead of one count per sprint plus one for the backlog.
  const counts = (await KanbanCard.count({
    where: whereOf<CardRow>({ projectId, archivedAt: null }),
    group: ["sprintId"],
  })) as unknown as { sprintId: string | null; count: unknown }[];
  const countOf = new Map(counts.map((c) => [c.sprintId, Number(c.count)]));
  const result = sprints.map((s) => ({ ...serializeSprint(s), cardCount: countOf.get(s.id) || 0 }));
  const backlogCount = countOf.get(null) || 0;
  return { sprints: result, backlogCount };
};

const createSprint = async (user: KanbanUser, projectId: string, data: SprintInput, actor: AuditActorInput | null = null): Promise<Record<string, unknown>> => {
  await assertAccess(user, projectId, "owner");
  const count = await KanbanSprint.count({ where: { projectId } });
  const sprint = await sequelize.transaction(async (transaction) => {
    const created = await KanbanSprint.create(
      asCreate<SprintRow>({
        projectId,
        name: data.name,
        goal: data.goal || null,
        status: data.status || "planned",
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        position: data.position ?? count,
      }),
      { transaction },
    );
    await auditKanban(transaction, actor, user, "CREATE", "KanbanSprint", created.id, {
      operation: "KANBAN_SPRINT_CREATE",
      projectId,
      after: pickFields(created, ["name", "goal", "status", "startDate", "endDate", "position"]),
    });
    return created;
  });
  const payload = serializeSprint(sprint);
  emitToBoard(projectId, "kanban:sprint:created", { sprint: payload });
  return payload;
};

const updateSprint = async (user: KanbanUser, projectId: string, sprintId: string, data: SprintInput, actor: AuditActorInput | null = null): Promise<Record<string, unknown>> => {
  await assertAccess(user, projectId, "owner");
  const sprint = await KanbanSprint.findOne({
    where: { id: sprintId, projectId },
  });
  if (!sprint) {throw new AppError(404, "Sprint not found");}
  const patch: Record<string, unknown> = {};
  for (const f of ["name", "goal", "status", "startDate", "endDate", "position"]) {
    if (data[f] !== undefined) {patch[f] = data[f];}
  }
  const before = pickFields(sprint, ["name", "goal", "status", "startDate", "endDate", "position"]);
  await sequelize.transaction(async (transaction) => {
    await sprint.update(patch, { transaction });
    await auditKanban(transaction, actor, user, "UPDATE", "KanbanSprint", sprint.id, {
      operation: "KANBAN_SPRINT_UPDATE",
      projectId,
      before,
      after: pickFields(sprint, ["name", "goal", "status", "startDate", "endDate", "position"]),
    });
  });
  const payload = serializeSprint(sprint);
  emitToBoard(projectId, "kanban:sprint:updated", { sprint: payload });
  return payload;
};

const deleteSprint = async (user: KanbanUser, projectId: string, sprintId: string, actor: AuditActorInput | null = null): Promise<{ deleted: true }> => {
  await assertAccess(user, projectId, "owner");
  const sprint = await KanbanSprint.findOne({
    where: { id: sprintId, projectId },
  });
  if (!sprint) {throw new AppError(404, "Sprint not found");}
  // Cards fall back to the backlog (sprint_id -> NULL via FK on delete).
  await sequelize.transaction(async (transaction) => {
    await sprint.destroy({ transaction });
    await auditKanban(transaction, actor, user, "DELETE", "KanbanSprint", sprint.id, {
      operation: "KANBAN_SPRINT_DELETE",
      projectId,
      before: pickFields(sprint, ["name", "goal", "status", "startDate", "endDate", "position"]),
    });
  });
  emitToBoard(projectId, "kanban:sprint:deleted", { sprintId });
  return { deleted: true };
};

/**
 * Move cards into a target sprint (or the backlog when targetSprintId is null).
 * Either an explicit list of cardIds, or — when `allNotDone` is set — every
 * card in the source not sitting in a Done column.
 */
const migrateCards = async (user: KanbanUser, projectId: string, data: MigrateInput, actor: AuditActorInput | null = null): Promise<{ migrated: number; targetSprintId: string | null }> => {
  await assertAccess(user, projectId, "editor");
  const { cardIds, allNotDone, fromSprintId, targetSprintId } = data;

  let targetId: string | null = null;
  if (targetSprintId && targetSprintId !== "backlog") {
    const target = await KanbanSprint.findOne({
      where: { id: targetSprintId, projectId },
    });
    if (!target) {throw new AppError(404, "Target sprint not found");}
    targetId = target.id;
  }

  const where: Record<string | symbol, unknown> = { projectId, archivedAt: null };
  if (Array.isArray(cardIds) && cardIds.length) {
    where["id"] = { [Op.in]: cardIds };
  } else if (allNotDone) {
    // Everything not in a Done column; optionally limited to one source sprint.
    const doneColumns = await KanbanColumn.findAll({
      where: { projectId, isDone: true },
      attributes: ["id"],
    });
    const doneIds = doneColumns.map((c) => c.id);
    if (doneIds.length) {where["columnId"] = { [Op.notIn]: doneIds };}
    if (fromSprintId !== undefined) {
      where["sprintId"] =
        fromSprintId === "backlog" || fromSprintId === null
          ? null
          : fromSprintId;
    }
  } else {
    throw new AppError(400, "Provide cardIds or set allNotDone");
  }

  const count = await sequelize.transaction(async (transaction) => {
    const [updated] = await KanbanCard.update({ sprintId: targetId }, { where: whereOf<CardRow>(where), transaction });
    // The selection as asked (explicit ids, or "every card not Done"), not a
    // read of every moved card: that would be an unbounded findAll (D-24).
    await auditKanban(transaction, actor, user, "UPDATE", "KanbanProject", projectId, {
      operation: "KANBAN_CARDS_MIGRATE",
      projectId,
      targetSprintId: targetId,
      selection: where["id"] ? { cardIds } : { allNotDone: true, fromSprintId: fromSprintId ?? null },
      count: updated,
    });
    return updated;
  });
  emitToBoard(projectId, "kanban:cards:migrated", {
    targetSprintId: targetId,
    count,
  });
  return { migrated: count, targetSprintId: targetId };
};

// ------------------------------------------------------------------
// Card relations (parent_of / child_of / blocks / blocked_by / relates_to ...)
// ------------------------------------------------------------------

const addRelation = async (user: KanbanUser, projectId: string, cardId: string, data: RelationInput, actor: AuditActorInput | null = null): Promise<unknown[]> => {
  await assertAccess(user, projectId, "editor");
  const { targetCardId, type } = data;
  const inverse = RELATION_INVERSE[type];
  if (!inverse) {throw new AppError(400, "Unknown relation type");}
  if (targetCardId === cardId) {
    throw new AppError(400, "A card cannot relate to itself");
  }

  const [source, target] = await Promise.all([
    KanbanCard.findOne({ where: { id: cardId, projectId } }),
    KanbanCard.findOne({ where: { id: targetCardId, projectId } }),
  ]);
  if (!source) {throw new AppError(404, "Card not found");}
  if (!target) {throw new AppError(404, "Target card not found");}

  // Store both directions so either card sees the link without an OR query.
  await sequelize.transaction(async (transaction) => {
    await KanbanCardRelation.bulkCreate(
      asCreateMany<ModelInstance<"KanbanCardRelation">>([
        { projectId, sourceCardId: cardId, targetCardId, type },
        {
          projectId,
          sourceCardId: targetCardId,
          targetCardId: cardId,
          type: inverse,
        },
      ]),
      { transaction, ignoreDuplicates: true },
    );
    await auditKanban(transaction, actor, user, "CREATE", "KanbanCardRelation", null, {
      operation: "KANBAN_RELATION_ADD",
      projectId,
      after: { sourceCardId: cardId, targetCardId, type },
    });
  });

  const relations = await loadRelations(cardId);
  emitToBoard(projectId, "kanban:card:relations", { cardId, relations });
  return relations;
};

const removeRelation = async (user: KanbanUser, projectId: string, cardId: string, relationId: string, actor: AuditActorInput | null = null): Promise<unknown[]> => {
  await assertAccess(user, projectId, "editor");
  const relation = await KanbanCardRelation.findOne({
    where: { id: relationId, projectId, sourceCardId: cardId },
  });
  if (!relation) {throw new AppError(404, "Relation not found");}
  // Remove the mirror row too.
  await sequelize.transaction(async (transaction) => {
    await KanbanCardRelation.destroy({
      where: {
        projectId,
        sourceCardId: relation.targetCardId,
        targetCardId: relation.sourceCardId,
        type: RELATION_INVERSE[relation.type],
      },
      transaction,
    });
    await relation.destroy({ transaction });
    await auditKanban(transaction, actor, user, "DELETE", "KanbanCardRelation", relation.id, {
      operation: "KANBAN_RELATION_REMOVE",
      projectId,
      before: { sourceCardId: relation.sourceCardId, targetCardId: relation.targetCardId, type: relation.type },
    });
  });
  const relations = await loadRelations(cardId);
  emitToBoard(projectId, "kanban:card:relations", { cardId, relations });
  return relations;
};

// ------------------------------------------------------------------
// Metrics / KPIs
// ------------------------------------------------------------------

/**
 * Board analytics for the dashboard. Scoped like getProject:
 *   options.sprintId = <uuid> | "backlog" | "all" | undefined (→ all).
 * Metrics default to the whole board ("all") since KPIs are most useful
 * across the project, not one sprint.
 */
const getMetrics = async (user: KanbanUser, projectId: string, options: { sprintId?: string | null | undefined } = {}): Promise<Record<string, unknown>> => {
  await assertAccess(user, projectId, "viewer");

  const [columns, sprints, labels] = await Promise.all([
    KanbanColumn.findAll({
      where: { projectId },
      order: [["position", "ASC"]],
    }),
    KanbanSprint.findAll({
      where: { projectId },
      order: [["position", "ASC"]],
    }),
    KanbanLabel.findAll({ where: { projectId }, order: [["name", "ASC"]] }),
  ]);

  const view: string = options.sprintId || "all";
  const cardWhere: Record<string, unknown> = { projectId, archivedAt: null };
  if (view === "backlog") {cardWhere["sprintId"] = null;}
  else if (view !== "all") {cardWhere["sprintId"] = view;}

  const cards = await KanbanCard.findAll({
    where: whereOf<CardRow>(cardWhere),
    include: cardInclude(),
    order: [["position", "ASC"]],
  });

  const doneColumnIds = new Set(
    columns.filter((c) => c.isDone).map((c) => c.id),
  );
  const now = Date.now();

  const total = cards.length;
  const doneCards = cards.filter((c) => doneColumnIds.has(c.columnId));
  const done = doneCards.length;
  const overdue = cards.filter(
    (c) =>
      c.dueDate &&
      !doneColumnIds.has(c.columnId) &&
      new Date(c.dueDate).getTime() < now,
  ).length;
  const unassigned = cards.filter(
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
    (c) => !(c.assignees && c.assignees.length),
  ).length;

  // Per-column distribution (+ WIP breaches).
  const byColumn = columns.map((col) => {
    const count = cards.filter((c) => c.columnId === col.id).length;
    return {
      columnId: col.id,
      name: col.name,
      isDone: col.isDone,
      wipLimit: col.wipLimit,
      count,
      overWip: col.wipLimit != null && count > col.wipLimit,
    };
  });

  // Priority distribution (null → "none").
  const priorities = ["urgent", "high", "medium", "low", "none"];
  const byPriority = priorities.map((p) => ({
    priority: p,
    count: cards.filter((c) => (c.priority || "none") === p).length,
  }));

  // Assignee workload.
  const assigneeMap = new Map<string, { userId: string; name: string; count: number }>();
  for (const c of cards) {
    for (const a of c.assignees || []) {
      const entry = assigneeMap.get(a.id) || {
        userId: a.id,
        name:
          [a.firstName, a.lastName].filter(Boolean).join(" ") || a.email,
        count: 0,
      };
      entry.count += 1;
      assigneeMap.set(a.id, entry);
    }
  }
  const byAssignee = [...assigneeMap.values()].sort(
    (a, b) => b.count - a.count,
  );

  // Label distribution.
  const byLabel = labels.map((l) => ({
    labelId: l.id,
    name: l.name,
    color: l.color,
    count: cards.filter((c) => (c.labels || []).some((x) => x.id === l.id))
      .length,
  }));

  // Per-sprint counts (backlog included) — only queried when viewing "all".
  let bySprint: { sprintId: string | null; name: string; status: string | null; count: number }[] = [];
  if (view === "all") {
    bySprint = sprints.map((s) => ({
      sprintId: s.id,
      name: s.name,
      status: s.status,
      count: cards.filter((c) => c.sprintId === s.id).length,
    }));
    bySprint.push({
      sprintId: null,
      name: "Backlog",
      status: null,
      count: cards.filter((c) => c.sprintId == null).length,
    });
  }

  return {
    view,
    summary: {
      total,
      done,
      inProgress: total - done,
      completionRate: total ? Math.round((done / total) * 100) : 0,
      overdue,
      unassigned,
      columns: columns.length,
      sprints: sprints.length,
    },
    byColumn,
    byPriority,
    byAssignee,
    byLabel,
    bySprint,
  };
};

/** Single card detail (assignees + labels + relations). */
const getCard = async (user: KanbanUser, projectId: string, cardId: string): Promise<Record<string, unknown>> => {
  await assertAccess(user, projectId, "viewer");
  const card = await loadCard(cardId);
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  if (!card || card.projectId !== projectId) {
    throw new AppError(404, "Card not found");
  }
  return serializeCard(card);
};

const service = {
  assertAccess,
  USER_NOT_IN_TENANT,
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  addMember,
  updateMember,
  removeMember,
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  createCard,
  updateCard,
  moveCard,
  deleteCard,
  createLabel,
  updateLabel,
  deleteLabel,
  listSprints,
  createSprint,
  updateSprint,
  deleteSprint,
  migrateCards,
  addRelation,
  removeRelation,
  getMetrics,
  getCard,
  // Exposed for controller-side attachment wiring / tests.
  _resolveAccess: resolveAccess,
  _serializeCard: serializeCard,
  _loadCard: loadCard,
  notifyCardActivity: notifyAssignees,
};

export = service;
