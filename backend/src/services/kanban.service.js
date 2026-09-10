/**
 * Kanban Service
 *
 * Project-tracker boards. One project === one board with its own columns,
 * cards, labels and membership. Enforces per-project access (owner/editor/
 * viewer, grantable by user OR role), emits realtime board updates, and
 * notifies assignees/watchers on card activity.
 */
const { Op } = require("sequelize");
const models = require("../models");
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
const { AppError } = require("../utils/appError.util");
const { emitToBoard } = require("../config/socket");
const notificationService = require("../services/notification.service");
const { logger } = require("../middlewares/activityLog.middleware");

// ------------------------------------------------------------------
// Access control
// ------------------------------------------------------------------

const LEVELS = { viewer: 1, editor: 2, owner: 3 };
// The last column is the terminal "Done" column: persistent (undeletable) and
// always kept last.
const DEFAULT_COLUMNS = [
  { name: "To Do", isDone: false },
  { name: "In Progress", isDone: false },
  { name: "Done", isDone: true },
];

// Valid card-relation types and their inverse (written in both directions so a
// card sees every relation without an OR query).
const RELATION_INVERSE = {
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
const codePrefix = (project) => {
  const fromCode = (project.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (fromCode) return fromCode;

  const fromName = (project.name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return fromName || "CARD";
};

const isSuperAdmin = (user) => {
  const name = user?.role?.name;
  return name === "SUPER_ADMIN" || name === "SUPERADMIN";
};

const userRoleId = (user) => user?.role?.id || user?.roleId || null;

/**
 * Resolve a user's effective access level to a project, or null if none.
 * Super admins are treated as owners. Otherwise the highest level granted
 * either directly (by userId) or via their role (by roleId) wins.
 */
const resolveAccess = async (user, projectId) => {
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
  const level = Object.keys(LEVELS).find((k) => LEVELS[k] === best);
  return { project, level };
};

/**
 * Throw unless `user` has at least `minLevel` on `projectId`.
 * Returns the loaded project on success.
 */
const assertAccess = async (user, projectId, minLevel = "viewer") => {
  const { project, level } = await resolveAccess(user, projectId);
  if (!level || LEVELS[level] < LEVELS[minLevel]) {
    // 404 (not 403) for a viewer-level miss so we don't reveal the project
    // exists to someone with no access at all.
    if (!level) throw new AppError(404, "Project not found");
    throw new AppError(403, `Requires ${minLevel} access to this project`);
  }
  return { project, level };
};

exports.assertAccess = assertAccess;

// ------------------------------------------------------------------
// Serialization
// ------------------------------------------------------------------

const userBrief = (u) =>
  u
    ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }
    : null;

const serializeCard = (card) => ({
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
const cardInclude = () => [
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
const loadCard = async (id) => {
  const card = await KanbanCard.findByPk(id);
  if (!card) return null;
  const [assignees, labels, relations] = await Promise.all([
    card.getAssignees({
      attributes: ["id", "firstName", "lastName", "email"],
      joinTableAttributes: [],
    }),
    card.getLabels({
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
const loadRelations = async (cardId) => {
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
const notifyAssignees = async (card, actorId, { title, message }) => {
  const targets = new Set((card.assignees || []).map((u) => u.id));
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
const notifyTagged = async (card, userIds, actorId, actorName) => {
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

const actorName = (user) =>
  [user.firstName, user.lastName].filter(Boolean).join(" ") ||
  user.email ||
  "Someone";

// ------------------------------------------------------------------
// Projects
// ------------------------------------------------------------------

/** List every board the user can see in their tenant. */
exports.listProjects = async (user) => {
  const where = { tenantId: user.tenantId, archivedAt: null };

  let projects;
  if (isSuperAdmin(user)) {
    projects = await KanbanProject.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });
  } else {
    const rid = userRoleId(user);
    const memberships = await KanbanProjectMember.findAll({
      where: {
        [Op.or]: [{ userId: user.id }, ...(rid ? [{ roleId: rid }] : [])],
      },
      attributes: ["projectId"],
    });
    const ids = memberships.map((m) => m.projectId);
    projects = await KanbanProject.findAll({
      where: {
        ...where,
        [Op.or]: [{ id: { [Op.in]: ids } }, { createdBy: user.id }],
      },
      order: [["createdAt", "DESC"]],
    });
  }

  // Attach a lightweight card count + the caller's own access level.
  const result = [];
  for (const p of projects) {
    const cardCount = await KanbanCard.count({
      where: { projectId: p.id, archivedAt: null },
    });
    const { level } = await resolveAccess(user, p.id).catch(() => ({
      level: null,
    }));
    result.push({
      id: p.id,
      name: p.name,
      description: p.description,
      color: p.color,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      cardCount,
      myAccess: level,
    });
  }
  return result;
};

exports.createProject = async (user, data) => {
  const { name, description, color, code, members = [] } = data;

  const created = await sequelize.transaction(async (transaction) => {
    const project = await KanbanProject.create(
      {
        tenantId: user.tenantId,
        name,
        code: code ? code.toUpperCase() : null,
        description: description || null,
        color: color || null,
        createdBy: user.id,
      },
      { transaction },
    );

    // Creator is the owner.
    await KanbanProjectMember.create(
      { projectId: project.id, userId: user.id, accessLevel: "owner" },
      { transaction },
    );

    // Any extra members supplied at creation.
    for (const m of members) {
      await KanbanProjectMember.create(
        {
          projectId: project.id,
          userId: m.userId || null,
          roleId: m.roleId || null,
          accessLevel: m.accessLevel || "viewer",
        },
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
      {
        projectId: project.id,
        name: "Sprint 1",
        status: "active",
        position: 0,
      },
      { transaction },
    );

    return project;
  });

  return exports.getProject(user, created.id);
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
exports.getProject = async (user, projectId, options = {}) => {
  const { project, level } = await assertAccess(user, projectId, "viewer");

  const sprints = await KanbanSprint.findAll({
    where: { projectId },
    order: [["position", "ASC"], ["createdAt", "ASC"]],
  });

  // Decide which sprint's cards to load.
  let sprintId = options.sprintId;
  if (sprintId === undefined) {
    const active = sprints.find((s) => s.status === "active");
    sprintId = active ? active.id : "backlog";
  }
  const cardWhere = { projectId, archivedAt: null };
  if (sprintId === "backlog") {
    cardWhere.sprintId = null;
  } else if (sprintId !== "all") {
    cardWhere.sprintId = sprintId;
  }

  const [columns, cards, labels, members] = await Promise.all([
    KanbanColumn.findAll({
      where: { projectId },
      order: [["position", "ASC"]],
    }),
    KanbanCard.findAll({
      where: cardWhere,
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

const serializeSprint = (s) => ({
  id: s.id,
  name: s.name,
  goal: s.goal,
  status: s.status,
  startDate: s.startDate,
  endDate: s.endDate,
  position: s.position,
});

exports.updateProject = async (user, projectId, data) => {
  await assertAccess(user, projectId, "owner");
  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.code !== undefined) {
    patch.code = data.code ? data.code.toUpperCase() : null;
  }
  if (data.description !== undefined) patch.description = data.description;
  if (data.color !== undefined) patch.color = data.color;
  if (data.archived !== undefined) {
    patch.archivedAt = data.archived ? new Date() : null;
  }
  await KanbanProject.update(patch, { where: { id: projectId } });
  const result = await exports.getProject(user, projectId);
  emitToBoard(projectId, "kanban:project:updated", { project: result });
  return result;
};

exports.deleteProject = async (user, projectId) => {
  await assertAccess(user, projectId, "owner");
  // Paranoid destroy; children cascade at the DB level.
  await KanbanProject.destroy({ where: { id: projectId } });
  emitToBoard(projectId, "kanban:project:deleted", { projectId });
  return { deleted: true };
};

// ------------------------------------------------------------------
// Members
// ------------------------------------------------------------------

exports.addMember = async (user, projectId, data) => {
  await assertAccess(user, projectId, "owner");
  if (!data.userId && !data.roleId) {
    throw new AppError(400, "A userId or roleId is required");
  }
  const member = await KanbanProjectMember.create({
    projectId,
    userId: data.userId || null,
    roleId: data.roleId || null,
    accessLevel: data.accessLevel || "viewer",
  });
  const result = await exports.getProject(user, projectId);
  emitToBoard(projectId, "kanban:project:updated", { project: result });
  return { memberId: member.id, members: result.members };
};

exports.updateMember = async (user, projectId, memberId, data) => {
  await assertAccess(user, projectId, "owner");
  const member = await KanbanProjectMember.findOne({
    where: { id: memberId, projectId },
  });
  if (!member) throw new AppError(404, "Member not found");
  await member.update({ accessLevel: data.accessLevel });
  const result = await exports.getProject(user, projectId);
  emitToBoard(projectId, "kanban:project:updated", { project: result });
  return result.members;
};

exports.removeMember = async (user, projectId, memberId) => {
  await assertAccess(user, projectId, "owner");
  const member = await KanbanProjectMember.findOne({
    where: { id: memberId, projectId },
  });
  if (!member) throw new AppError(404, "Member not found");
  // Never leave a board without an owner.
  if (member.accessLevel === "owner") {
    const owners = await KanbanProjectMember.count({
      where: { projectId, accessLevel: "owner" },
    });
    if (owners <= 1) {
      throw new AppError(400, "A project must keep at least one owner");
    }
  }
  await member.destroy();
  const result = await exports.getProject(user, projectId);
  emitToBoard(projectId, "kanban:project:updated", { project: result });
  return { removed: true };
};

// ------------------------------------------------------------------
// Columns (owner manages the flow)
// ------------------------------------------------------------------

exports.createColumn = async (user, projectId, data) => {
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
    return KanbanColumn.create(
      {
        projectId,
        name: data.name,
        position,
        wipLimit: data.wipLimit ?? null,
        isDone: false,
      },
      { transaction },
    );
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

exports.updateColumn = async (user, projectId, columnId, data) => {
  await assertAccess(user, projectId, "owner");
  const column = await KanbanColumn.findOne({
    where: { id: columnId, projectId },
  });
  if (!column) throw new AppError(404, "Column not found");
  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.wipLimit !== undefined) patch.wipLimit = data.wipLimit;
  // Position is managed via reorderColumns (which keeps Done last); ignore any
  // direct position write on the Done column to avoid dislodging it.
  if (data.position !== undefined && !column.isDone) {
    patch.position = data.position;
  }
  await column.update(patch);
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

exports.deleteColumn = async (user, projectId, columnId) => {
  await assertAccess(user, projectId, "owner");
  const column = await KanbanColumn.findOne({
    where: { id: columnId, projectId },
  });
  if (!column) throw new AppError(404, "Column not found");
  if (column.isDone) {
    throw new AppError(400, "The Done column cannot be deleted");
  }
  const remaining = await KanbanColumn.count({ where: { projectId } });
  if (remaining <= 1) {
    throw new AppError(400, "A project must keep at least one column");
  }
  await column.destroy(); // cards cascade
  emitToBoard(projectId, "kanban:column:deleted", { columnId });
  return { deleted: true };
};

exports.reorderColumns = async (user, projectId, order) => {
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
    if (doneId) seq.push(doneId);
    for (let i = 0; i < seq.length; i++) {
      await KanbanColumn.update(
        { position: i },
        { where: { id: seq[i], projectId }, transaction },
      );
    }
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

exports.createCard = async (user, projectId, data) => {
  const { project } = await assertAccess(user, projectId, "editor");

  const column = await KanbanColumn.findOne({
    where: { id: data.columnId, projectId },
  });
  if (!column) throw new AppError(404, "Column not found");

  // Resolve the target sprint: explicit value wins ("backlog"/null => backlog);
  // otherwise the card lands in the project's active sprint.
  let sprintId;
  if (data.sprintId === "backlog" || data.sprintId === null) {
    sprintId = null;
  } else if (data.sprintId) {
    const sprint = await KanbanSprint.findOne({
      where: { id: data.sprintId, projectId },
    });
    if (!sprint) throw new AppError(404, "Sprint not found");
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
      where: { columnId: data.columnId, archivedAt: null },
      transaction,
    });
    // Atomically claim the next per-project sequence number for the card key.
    const [[seqRow]] = await sequelize.query(
      `UPDATE kanban_projects SET card_seq = card_seq + 1, updated_at = NOW()
       WHERE id = :projectId RETURNING card_seq`,
      {
        replacements: { projectId },
        transaction,
      },
    );
    const number = seqRow.card_seq;
    const cardKey = `${codePrefix(project)}-${number}`;
    const created = await KanbanCard.create(
      {
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
      },
      { transaction },
    );

    if (data.assigneeIds?.length) {
      await KanbanCardAssignee.bulkCreate(
        data.assigneeIds.map((userId) => ({ cardId: created.id, userId })),
        { transaction, ignoreDuplicates: true },
      );
    }
    if (data.labelIds?.length) {
      // Explicit join inserts rather than the setLabels mixin, which trips on
      // this through-model's shape (matches how assignees are handled above).
      await KanbanCardLabel.bulkCreate(
        data.labelIds.map((labelId) => ({ cardId: created.id, labelId })),
        { transaction, ignoreDuplicates: true },
      );
    }
    return created;
  });

  const full = await loadCard(card.id);
  emitToBoard(projectId, "kanban:card:created", { card: serializeCard(full) });

  // Assigning a user is the tagging event -> notify them.
  if (data.assigneeIds?.length) {
    await notifyTagged(full, data.assigneeIds, user.id, actorName(user));
  }
  return serializeCard(full);
};

exports.updateCard = async (user, projectId, cardId, data) => {
  await assertAccess(user, projectId, "editor");
  const card = await KanbanCard.findOne({
    where: { id: cardId, projectId },
    include: cardInclude(),
  });
  if (!card) throw new AppError(404, "Card not found");

  const previousAssignees = new Set((card.assignees || []).map((u) => u.id));

  await sequelize.transaction(async (transaction) => {
    const patch = {};
    for (const f of ["title", "description", "priority", "dueDate"]) {
      if (data[f] !== undefined) patch[f] = data[f];
    }
    if (data.sprintId !== undefined) {
      patch.sprintId =
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
          data.assigneeIds.map((userId) => ({ cardId, userId })),
          { transaction, ignoreDuplicates: true },
        );
      }
    }
    if (data.labelIds !== undefined) {
      await KanbanCardLabel.destroy({ where: { cardId }, transaction });
      if (data.labelIds.length) {
        await KanbanCardLabel.bulkCreate(
          data.labelIds.map((labelId) => ({ cardId, labelId })),
          { transaction, ignoreDuplicates: true },
        );
      }
    }
  });

  const full = await loadCard(cardId);
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

exports.moveCard = async (user, projectId, cardId, { columnId, position }) => {
  await assertAccess(user, projectId, "editor");
  const card = await KanbanCard.findOne({ where: { id: cardId, projectId } });
  if (!card) throw new AppError(404, "Card not found");
  const destColumn = await KanbanColumn.findOne({
    where: { id: columnId, projectId },
  });
  if (!destColumn) throw new AppError(404, "Destination column not found");

  const fromColumn = card.columnId;

  await sequelize.transaction(async (transaction) => {
    // Detach the card, then renumber destination with it inserted at `position`.
    card.columnId = columnId;
    await card.save({ transaction });

    const renumber = async (colId) => {
      const siblings = await KanbanCard.findAll({
        where: { columnId: colId, archivedAt: null },
        order: [["position", "ASC"]],
        transaction,
      });
      const ordered = siblings.filter((c) => c.id !== cardId);
      if (colId === columnId) {
        const idx = Math.min(Math.max(position, 0), ordered.length);
        ordered.splice(idx, 0, card);
      }
      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i].position !== i) {
          await KanbanCard.update(
            { position: i },
            { where: { id: ordered[i].id }, transaction },
          );
        }
      }
    };

    await renumber(columnId);
    if (fromColumn !== columnId) {
      await renumber(fromColumn);
    }
  });

  const full = await loadCard(cardId);
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

exports.deleteCard = async (user, projectId, cardId) => {
  await assertAccess(user, projectId, "editor");
  const card = await KanbanCard.findOne({ where: { id: cardId, projectId } });
  if (!card) throw new AppError(404, "Card not found");
  await card.destroy();
  emitToBoard(projectId, "kanban:card:deleted", { cardId, columnId: card.columnId });
  return { deleted: true };
};

// ------------------------------------------------------------------
// Labels (editor manages the tag palette)
// ------------------------------------------------------------------

exports.createLabel = async (user, projectId, data) => {
  await assertAccess(user, projectId, "editor");
  const label = await KanbanLabel.create({
    projectId,
    name: data.name,
    color: data.color || null,
  });
  const payload = { id: label.id, name: label.name, color: label.color };
  emitToBoard(projectId, "kanban:label:created", { label: payload });
  return payload;
};

exports.updateLabel = async (user, projectId, labelId, data) => {
  await assertAccess(user, projectId, "editor");
  const label = await KanbanLabel.findOne({
    where: { id: labelId, projectId },
  });
  if (!label) throw new AppError(404, "Label not found");
  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.color !== undefined) patch.color = data.color;
  await label.update(patch);
  const payload = { id: label.id, name: label.name, color: label.color };
  emitToBoard(projectId, "kanban:label:updated", { label: payload });
  return payload;
};

exports.deleteLabel = async (user, projectId, labelId) => {
  await assertAccess(user, projectId, "editor");
  const label = await KanbanLabel.findOne({
    where: { id: labelId, projectId },
  });
  if (!label) throw new AppError(404, "Label not found");
  await label.destroy(); // card_label join rows cascade
  emitToBoard(projectId, "kanban:label:deleted", { labelId });
  return { deleted: true };
};

// ------------------------------------------------------------------
// Sprints (owner manages; keep boards small by scoping cards to a sprint)
// ------------------------------------------------------------------

exports.listSprints = async (user, projectId) => {
  await assertAccess(user, projectId, "viewer");
  const sprints = await KanbanSprint.findAll({
    where: { projectId },
    order: [["position", "ASC"], ["createdAt", "ASC"]],
  });
  // Attach a card count per sprint (plus backlog) for the sprint picker.
  const result = [];
  for (const s of sprints) {
    const cardCount = await KanbanCard.count({
      where: { projectId, sprintId: s.id, archivedAt: null },
    });
    result.push({ ...serializeSprint(s), cardCount });
  }
  const backlogCount = await KanbanCard.count({
    where: { projectId, sprintId: null, archivedAt: null },
  });
  return { sprints: result, backlogCount };
};

exports.createSprint = async (user, projectId, data) => {
  await assertAccess(user, projectId, "owner");
  const count = await KanbanSprint.count({ where: { projectId } });
  const sprint = await KanbanSprint.create({
    projectId,
    name: data.name,
    goal: data.goal || null,
    status: data.status || "planned",
    startDate: data.startDate || null,
    endDate: data.endDate || null,
    position: data.position ?? count,
  });
  const payload = serializeSprint(sprint);
  emitToBoard(projectId, "kanban:sprint:created", { sprint: payload });
  return payload;
};

exports.updateSprint = async (user, projectId, sprintId, data) => {
  await assertAccess(user, projectId, "owner");
  const sprint = await KanbanSprint.findOne({
    where: { id: sprintId, projectId },
  });
  if (!sprint) throw new AppError(404, "Sprint not found");
  const patch = {};
  for (const f of ["name", "goal", "status", "startDate", "endDate", "position"]) {
    if (data[f] !== undefined) patch[f] = data[f];
  }
  await sprint.update(patch);
  const payload = serializeSprint(sprint);
  emitToBoard(projectId, "kanban:sprint:updated", { sprint: payload });
  return payload;
};

exports.deleteSprint = async (user, projectId, sprintId) => {
  await assertAccess(user, projectId, "owner");
  const sprint = await KanbanSprint.findOne({
    where: { id: sprintId, projectId },
  });
  if (!sprint) throw new AppError(404, "Sprint not found");
  // Cards fall back to the backlog (sprint_id -> NULL via FK on delete).
  await sprint.destroy();
  emitToBoard(projectId, "kanban:sprint:deleted", { sprintId });
  return { deleted: true };
};

/**
 * Move cards into a target sprint (or the backlog when targetSprintId is null).
 * Either an explicit list of cardIds, or — when `allNotDone` is set — every
 * card in the source not sitting in a Done column.
 */
exports.migrateCards = async (user, projectId, data) => {
  await assertAccess(user, projectId, "editor");
  const { cardIds, allNotDone, fromSprintId, targetSprintId } = data;

  let targetId = null;
  if (targetSprintId && targetSprintId !== "backlog") {
    const target = await KanbanSprint.findOne({
      where: { id: targetSprintId, projectId },
    });
    if (!target) throw new AppError(404, "Target sprint not found");
    targetId = target.id;
  }

  const where = { projectId, archivedAt: null };
  if (Array.isArray(cardIds) && cardIds.length) {
    where.id = { [Op.in]: cardIds };
  } else if (allNotDone) {
    // Everything not in a Done column; optionally limited to one source sprint.
    const doneColumns = await KanbanColumn.findAll({
      where: { projectId, isDone: true },
      attributes: ["id"],
    });
    const doneIds = doneColumns.map((c) => c.id);
    if (doneIds.length) where.columnId = { [Op.notIn]: doneIds };
    if (fromSprintId !== undefined) {
      where.sprintId =
        fromSprintId === "backlog" || fromSprintId === null
          ? null
          : fromSprintId;
    }
  } else {
    throw new AppError(400, "Provide cardIds or set allNotDone");
  }

  const [count] = await KanbanCard.update(
    { sprintId: targetId },
    { where },
  );
  emitToBoard(projectId, "kanban:cards:migrated", {
    targetSprintId: targetId,
    count,
  });
  return { migrated: count, targetSprintId: targetId };
};

// ------------------------------------------------------------------
// Card relations (parent_of / child_of / blocks / blocked_by / relates_to ...)
// ------------------------------------------------------------------

exports.addRelation = async (user, projectId, cardId, data) => {
  await assertAccess(user, projectId, "editor");
  const { targetCardId, type } = data;
  const inverse = RELATION_INVERSE[type];
  if (!inverse) throw new AppError(400, "Unknown relation type");
  if (targetCardId === cardId) {
    throw new AppError(400, "A card cannot relate to itself");
  }

  const [source, target] = await Promise.all([
    KanbanCard.findOne({ where: { id: cardId, projectId } }),
    KanbanCard.findOne({ where: { id: targetCardId, projectId } }),
  ]);
  if (!source) throw new AppError(404, "Card not found");
  if (!target) throw new AppError(404, "Target card not found");

  // Store both directions so either card sees the link without an OR query.
  await sequelize.transaction(async (transaction) => {
    await KanbanCardRelation.bulkCreate(
      [
        { projectId, sourceCardId: cardId, targetCardId, type },
        {
          projectId,
          sourceCardId: targetCardId,
          targetCardId: cardId,
          type: inverse,
        },
      ],
      { transaction, ignoreDuplicates: true },
    );
  });

  const relations = await loadRelations(cardId);
  emitToBoard(projectId, "kanban:card:relations", { cardId, relations });
  return relations;
};

exports.removeRelation = async (user, projectId, cardId, relationId) => {
  await assertAccess(user, projectId, "editor");
  const relation = await KanbanCardRelation.findOne({
    where: { id: relationId, projectId, sourceCardId: cardId },
  });
  if (!relation) throw new AppError(404, "Relation not found");
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
exports.getMetrics = async (user, projectId, options = {}) => {
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

  const view = options.sprintId || "all";
  const cardWhere = { projectId, archivedAt: null };
  if (view === "backlog") cardWhere.sprintId = null;
  else if (view !== "all") cardWhere.sprintId = view;

  const cards = await KanbanCard.findAll({
    where: cardWhere,
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
  const assigneeMap = new Map();
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
  let bySprint = [];
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
exports.getCard = async (user, projectId, cardId) => {
  await assertAccess(user, projectId, "viewer");
  const card = await loadCard(cardId);
  if (!card || card.projectId !== projectId) {
    throw new AppError(404, "Card not found");
  }
  return serializeCard(card);
};

// Exposed for controller-side attachment wiring / tests.
exports._resolveAccess = resolveAccess;
exports._serializeCard = serializeCard;
exports._loadCard = loadCard;
exports.notifyCardActivity = notifyAssignees;
