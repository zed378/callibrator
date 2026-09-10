import { api } from "../client";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type AccessLevel = "owner" | "editor" | "viewer";
export type Priority = "low" | "medium" | "high" | "urgent";
export type SprintStatus = "planned" | "active" | "completed";
export type RelationType =
  | "relates_to"
  | "duplicates"
  | "blocks"
  | "blocked_by"
  | "parent_of"
  | "child_of";

export interface UserBrief {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
}

export interface KanbanLabel {
  id: string;
  name: string;
  color?: string | null;
}

export interface KanbanColumn {
  id: string;
  name: string;
  position: number;
  wipLimit?: number | null;
  isDone: boolean;
}

export interface CardRelation {
  id: string;
  type: RelationType;
  card: {
    id: string;
    cardKey?: string | null;
    title: string;
    columnId: string;
  } | null;
}

export interface KanbanCard {
  id: string;
  projectId: string;
  columnId: string;
  sprintId?: string | null;
  number?: number | null;
  cardKey?: string | null;
  title: string;
  description?: string | null;
  position: number;
  priority?: Priority | null;
  dueDate?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  assignees: UserBrief[];
  labels: KanbanLabel[];
  relations?: CardRelation[];
}

export interface KanbanSprint {
  id: string;
  name: string;
  goal?: string | null;
  status: SprintStatus;
  startDate?: string | null;
  endDate?: string | null;
  position: number;
  cardCount?: number;
}

export interface KanbanMember {
  id: string;
  accessLevel: AccessLevel;
  user: UserBrief | null;
  role: { id: string; name: string } | null;
}

export interface KanbanProjectSummary {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  color?: string | null;
  createdBy?: string | null;
  createdAt: string;
  cardCount: number;
  myAccess: AccessLevel | null;
}

export interface KanbanBoard {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  color?: string | null;
  createdBy?: string | null;
  myAccess: AccessLevel;
  activeSprintId: string | null;
  columns: KanbanColumn[];
  cards: KanbanCard[];
  labels: KanbanLabel[];
  sprints: KanbanSprint[];
  members: KanbanMember[];
}

export interface KanbanMetrics {
  view: string;
  summary: {
    total: number;
    done: number;
    inProgress: number;
    completionRate: number;
    overdue: number;
    unassigned: number;
    columns: number;
    sprints: number;
  };
  byColumn: {
    columnId: string;
    name: string;
    isDone: boolean;
    wipLimit: number | null;
    count: number;
    overWip: boolean;
  }[];
  byPriority: { priority: string; count: number }[];
  byAssignee: { userId: string; name: string; count: number }[];
  byLabel: {
    labelId: string;
    name: string;
    color?: string | null;
    count: number;
  }[];
  bySprint: {
    sprintId: string | null;
    name: string;
    status: string | null;
    count: number;
  }[];
}

export interface MemberInput {
  userId?: string;
  roleId?: string;
  accessLevel?: AccessLevel;
}

export interface CreateProjectInput {
  name: string;
  code?: string | null;
  description?: string | null;
  color?: string | null;
  members?: MemberInput[];
}

export interface CreateCardInput {
  columnId: string;
  sprintId?: string | null;
  title: string;
  description?: string | null;
  priority?: Priority | null;
  dueDate?: string | null;
  assigneeIds?: string[];
  labelIds?: string[];
}

export interface UpdateCardInput {
  title?: string;
  description?: string | null;
  priority?: Priority | null;
  dueDate?: string | null;
  sprintId?: string | null;
  assigneeIds?: string[];
  labelIds?: string[];
}

type Env<T> = { success: boolean; message?: string; data: T };

const unwrap = <T,>(r: Env<T>): T => r.data;

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

const base = "/api/v1/kanban";

export const kanbanService = {
  // ---- Projects ----
  listProjects: async (): Promise<KanbanProjectSummary[]> =>
    unwrap(await api.get<Env<KanbanProjectSummary[]>>(`${base}/projects`)),

  createProject: async (data: CreateProjectInput): Promise<KanbanBoard> =>
    unwrap(await api.post<Env<KanbanBoard>>(`${base}/projects`, data)),

  getBoard: async (
    projectId: string,
    sprintId?: string,
  ): Promise<KanbanBoard> =>
    unwrap(
      await api.get<Env<KanbanBoard>>(`${base}/projects/${projectId}`, {
        params: sprintId ? { sprintId } : undefined,
      }),
    ),

  getMetrics: async (
    projectId: string,
    sprintId?: string,
  ): Promise<KanbanMetrics> =>
    unwrap(
      await api.get<Env<KanbanMetrics>>(
        `${base}/projects/${projectId}/metrics`,
        { params: sprintId ? { sprintId } : undefined },
      ),
    ),

  updateProject: async (
    projectId: string,
    data: Partial<CreateProjectInput> & { archived?: boolean },
  ): Promise<KanbanBoard> =>
    unwrap(
      await api.patch<Env<KanbanBoard>>(`${base}/projects/${projectId}`, data),
    ),

  deleteProject: async (projectId: string): Promise<void> => {
    await api.delete(`${base}/projects/${projectId}`);
  },

  // ---- Members ----
  addMember: async (projectId: string, data: MemberInput) =>
    unwrap(
      await api.post<Env<{ memberId: string; members: KanbanMember[] }>>(
        `${base}/projects/${projectId}/members`,
        data,
      ),
    ),

  updateMember: async (
    projectId: string,
    memberId: string,
    accessLevel: AccessLevel,
  ): Promise<KanbanMember[]> =>
    unwrap(
      await api.patch<Env<KanbanMember[]>>(
        `${base}/projects/${projectId}/members/${memberId}`,
        { accessLevel },
      ),
    ),

  removeMember: async (projectId: string, memberId: string): Promise<void> => {
    await api.delete(`${base}/projects/${projectId}/members/${memberId}`);
  },

  // ---- Sprints ----
  listSprints: async (
    projectId: string,
  ): Promise<{ sprints: KanbanSprint[]; backlogCount: number }> =>
    unwrap(
      await api.get<Env<{ sprints: KanbanSprint[]; backlogCount: number }>>(
        `${base}/projects/${projectId}/sprints`,
      ),
    ),

  createSprint: async (
    projectId: string,
    data: { name: string; goal?: string; status?: SprintStatus },
  ): Promise<KanbanSprint> =>
    unwrap(
      await api.post<Env<KanbanSprint>>(
        `${base}/projects/${projectId}/sprints`,
        data,
      ),
    ),

  updateSprint: async (
    projectId: string,
    sprintId: string,
    data: Partial<{ name: string; goal: string; status: SprintStatus }>,
  ): Promise<KanbanSprint> =>
    unwrap(
      await api.patch<Env<KanbanSprint>>(
        `${base}/projects/${projectId}/sprints/${sprintId}`,
        data,
      ),
    ),

  deleteSprint: async (projectId: string, sprintId: string): Promise<void> => {
    await api.delete(`${base}/projects/${projectId}/sprints/${sprintId}`);
  },

  migrateCards: async (
    projectId: string,
    data: {
      cardIds?: string[];
      allNotDone?: boolean;
      fromSprintId?: string | null;
      targetSprintId: string | null;
    },
  ): Promise<{ migrated: number; targetSprintId: string | null }> =>
    unwrap(
      await api.post<
        Env<{ migrated: number; targetSprintId: string | null }>
      >(`${base}/projects/${projectId}/sprints/migrate`, data),
    ),

  // ---- Columns ----
  createColumn: async (
    projectId: string,
    data: { name: string; wipLimit?: number | null },
  ): Promise<KanbanColumn> =>
    unwrap(
      await api.post<Env<KanbanColumn>>(
        `${base}/projects/${projectId}/columns`,
        data,
      ),
    ),

  updateColumn: async (
    projectId: string,
    columnId: string,
    data: { name?: string; wipLimit?: number | null },
  ): Promise<KanbanColumn> =>
    unwrap(
      await api.patch<Env<KanbanColumn>>(
        `${base}/projects/${projectId}/columns/${columnId}`,
        data,
      ),
    ),

  deleteColumn: async (projectId: string, columnId: string): Promise<void> => {
    await api.delete(`${base}/projects/${projectId}/columns/${columnId}`);
  },

  reorderColumns: async (
    projectId: string,
    order: string[],
  ): Promise<KanbanColumn[]> =>
    unwrap(
      await api.post<Env<KanbanColumn[]>>(
        `${base}/projects/${projectId}/columns/reorder`,
        { order },
      ),
    ),

  // ---- Cards ----
  getCard: async (projectId: string, cardId: string): Promise<KanbanCard> =>
    unwrap(
      await api.get<Env<KanbanCard>>(
        `${base}/projects/${projectId}/cards/${cardId}`,
      ),
    ),

  createCard: async (
    projectId: string,
    data: CreateCardInput,
  ): Promise<KanbanCard> =>
    unwrap(
      await api.post<Env<KanbanCard>>(
        `${base}/projects/${projectId}/cards`,
        data,
      ),
    ),

  updateCard: async (
    projectId: string,
    cardId: string,
    data: UpdateCardInput,
  ): Promise<KanbanCard> =>
    unwrap(
      await api.patch<Env<KanbanCard>>(
        `${base}/projects/${projectId}/cards/${cardId}`,
        data,
      ),
    ),

  moveCard: async (
    projectId: string,
    cardId: string,
    data: { columnId: string; position: number },
  ): Promise<KanbanCard> =>
    unwrap(
      await api.patch<Env<KanbanCard>>(
        `${base}/projects/${projectId}/cards/${cardId}/move`,
        data,
      ),
    ),

  deleteCard: async (projectId: string, cardId: string): Promise<void> => {
    await api.delete(`${base}/projects/${projectId}/cards/${cardId}`);
  },

  // ---- Card relations ----
  addRelation: async (
    projectId: string,
    cardId: string,
    data: { targetCardId: string; type: RelationType },
  ): Promise<CardRelation[]> =>
    unwrap(
      await api.post<Env<CardRelation[]>>(
        `${base}/projects/${projectId}/cards/${cardId}/relations`,
        data,
      ),
    ),

  removeRelation: async (
    projectId: string,
    cardId: string,
    relationId: string,
  ): Promise<CardRelation[]> =>
    unwrap(
      await api.delete<Env<CardRelation[]>>(
        `${base}/projects/${projectId}/cards/${cardId}/relations/${relationId}`,
      ),
    ),

  // ---- Labels ----
  createLabel: async (
    projectId: string,
    data: { name: string; color?: string | null },
  ): Promise<KanbanLabel> =>
    unwrap(
      await api.post<Env<KanbanLabel>>(
        `${base}/projects/${projectId}/labels`,
        data,
      ),
    ),

  updateLabel: async (
    projectId: string,
    labelId: string,
    data: { name?: string; color?: string | null },
  ): Promise<KanbanLabel> =>
    unwrap(
      await api.patch<Env<KanbanLabel>>(
        `${base}/projects/${projectId}/labels/${labelId}`,
        data,
      ),
    ),

  deleteLabel: async (projectId: string, labelId: string): Promise<void> => {
    await api.delete(`${base}/projects/${projectId}/labels/${labelId}`);
  },
};

export default kanbanService;
