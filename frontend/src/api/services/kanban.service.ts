// src/api/services/kanban.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. Every call and every type is
// read off `paths` (src/api/generated/schema.d.ts, generated from
// backend/src/routes/api/kanban.openapi.ts); the exported names are unchanged,
// so no caller changed.
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";

// ------------------------------------------------------------------
// Types — from the contract
// ------------------------------------------------------------------

type S = components["schemas"];
export type KanbanColumn = S["KanbanColumn"];
export type KanbanLabel = S["KanbanLabel"];
/** A sprint as a board carries it. Only `listSprints` adds a `cardCount` (S["KanbanSprintList"]). */
export type KanbanSprint = S["KanbanSprint"];
export type CardRelation = S["KanbanCardRelation"];
export type KanbanCard = S["KanbanCard"];
export type KanbanMember = S["KanbanProjectMember"];
export type KanbanProjectSummary = S["KanbanProjectSummary"];
export type KanbanBoard = S["KanbanBoard"];
export type KanbanMetrics = S["KanbanMetrics"];
export type AccessLevel = KanbanMember["accessLevel"];
export type Priority = NonNullable<KanbanCard["priority"]>;
export type SprintStatus = KanbanSprint["status"];
export type RelationType = CardRelation["type"];
export type UserBrief = KanbanCard["assignees"][number];

type P = "/api/v1/kanban/projects/{projectId}";
export type CreateProjectInput = JsonBody<Op<"/api/v1/kanban/projects", "post">>;
export type MemberInput = JsonBody<Op<`${P}/members`, "post">>;
export type CreateCardInput = JsonBody<Op<`${P}/cards`, "post">>;
export type UpdateCardInput = JsonBody<Op<`${P}/cards/{cardId}`, "patch">>;

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

const project = (projectId: string) => ({ params: { path: { projectId } } });

export const kanbanService = {
  // ---- Projects ----
  listProjects: async (): Promise<KanbanProjectSummary[]> =>
    (await typedApi.GET("/api/v1/kanban/projects").then(unwrap)).data,

  createProject: async (data: CreateProjectInput): Promise<KanbanBoard> =>
    (await typedApi.POST("/api/v1/kanban/projects", { body: data }).then(unwrap)).data,

  getBoard: async (projectId: string, sprintId?: string): Promise<KanbanBoard> =>
    (
      await typedApi
        .GET("/api/v1/kanban/projects/{projectId}", {
          params: { path: { projectId }, ...(sprintId ? { query: { sprintId } } : {}) },
        })
        .then(unwrap)
    ).data,

  getMetrics: async (projectId: string, sprintId?: string): Promise<KanbanMetrics> =>
    (
      await typedApi
        .GET("/api/v1/kanban/projects/{projectId}/metrics", {
          params: { path: { projectId }, ...(sprintId ? { query: { sprintId } } : {}) },
        })
        .then(unwrap)
    ).data,

  updateProject: async (projectId: string, data: JsonBody<Op<P, "patch">>): Promise<KanbanBoard> =>
    (await typedApi.PATCH("/api/v1/kanban/projects/{projectId}", { ...project(projectId), body: data }).then(unwrap)).data,

  deleteProject: async (projectId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/kanban/projects/{projectId}", project(projectId));
  },

  // ---- Members ----
  addMember: async (projectId: string, data: MemberInput): Promise<DataOf<Op<`${P}/members`, "post">>> =>
    (await typedApi.POST("/api/v1/kanban/projects/{projectId}/members", { ...project(projectId), body: data }).then(unwrap)).data,

  updateMember: async (projectId: string, memberId: string, accessLevel: AccessLevel): Promise<KanbanMember[]> =>
    (
      await typedApi
        .PATCH("/api/v1/kanban/projects/{projectId}/members/{memberId}", {
          params: { path: { projectId, memberId } },
          body: { accessLevel },
        })
        .then(unwrap)
    ).data,

  removeMember: async (projectId: string, memberId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/kanban/projects/{projectId}/members/{memberId}", {
      params: { path: { projectId, memberId } },
    });
  },

  // ---- Sprints ----
  listSprints: async (projectId: string): Promise<S["KanbanSprintList"]> =>
    (await typedApi.GET("/api/v1/kanban/projects/{projectId}/sprints", project(projectId)).then(unwrap)).data,

  createSprint: async (projectId: string, data: JsonBody<Op<`${P}/sprints`, "post">>): Promise<KanbanSprint> =>
    (await typedApi.POST("/api/v1/kanban/projects/{projectId}/sprints", { ...project(projectId), body: data }).then(unwrap)).data,

  updateSprint: async (
    projectId: string,
    sprintId: string,
    data: JsonBody<Op<`${P}/sprints/{sprintId}`, "patch">>,
  ): Promise<KanbanSprint> =>
    (
      await typedApi
        .PATCH("/api/v1/kanban/projects/{projectId}/sprints/{sprintId}", {
          params: { path: { projectId, sprintId } },
          body: data,
        })
        .then(unwrap)
    ).data,

  deleteSprint: async (projectId: string, sprintId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/kanban/projects/{projectId}/sprints/{sprintId}", {
      params: { path: { projectId, sprintId } },
    });
  },

  migrateCards: async (
    projectId: string,
    data: JsonBody<Op<`${P}/sprints/migrate`, "post">>,
  ): Promise<DataOf<Op<`${P}/sprints/migrate`, "post">>> =>
    (await typedApi.POST("/api/v1/kanban/projects/{projectId}/sprints/migrate", { ...project(projectId), body: data }).then(unwrap))
      .data,

  // ---- Columns ----
  createColumn: async (projectId: string, data: JsonBody<Op<`${P}/columns`, "post">>): Promise<KanbanColumn> =>
    (await typedApi.POST("/api/v1/kanban/projects/{projectId}/columns", { ...project(projectId), body: data }).then(unwrap)).data,

  updateColumn: async (
    projectId: string,
    columnId: string,
    data: JsonBody<Op<`${P}/columns/{columnId}`, "patch">>,
  ): Promise<KanbanColumn> =>
    (
      await typedApi
        .PATCH("/api/v1/kanban/projects/{projectId}/columns/{columnId}", {
          params: { path: { projectId, columnId } },
          body: data,
        })
        .then(unwrap)
    ).data,

  deleteColumn: async (projectId: string, columnId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/kanban/projects/{projectId}/columns/{columnId}", {
      params: { path: { projectId, columnId } },
    });
  },

  reorderColumns: async (projectId: string, order: string[]): Promise<KanbanColumn[]> =>
    (
      await typedApi
        .POST("/api/v1/kanban/projects/{projectId}/columns/reorder", { ...project(projectId), body: { order } })
        .then(unwrap)
    ).data,

  // ---- Cards ----
  getCard: async (projectId: string, cardId: string): Promise<KanbanCard> =>
    (
      await typedApi
        .GET("/api/v1/kanban/projects/{projectId}/cards/{cardId}", { params: { path: { projectId, cardId } } })
        .then(unwrap)
    ).data,

  createCard: async (projectId: string, data: CreateCardInput): Promise<KanbanCard> =>
    (await typedApi.POST("/api/v1/kanban/projects/{projectId}/cards", { ...project(projectId), body: data }).then(unwrap)).data,

  updateCard: async (projectId: string, cardId: string, data: UpdateCardInput): Promise<KanbanCard> =>
    (
      await typedApi
        .PATCH("/api/v1/kanban/projects/{projectId}/cards/{cardId}", {
          params: { path: { projectId, cardId } },
          body: data,
        })
        .then(unwrap)
    ).data,

  moveCard: async (
    projectId: string,
    cardId: string,
    data: JsonBody<Op<`${P}/cards/{cardId}/move`, "patch">>,
  ): Promise<KanbanCard> =>
    (
      await typedApi
        .PATCH("/api/v1/kanban/projects/{projectId}/cards/{cardId}/move", {
          params: { path: { projectId, cardId } },
          body: data,
        })
        .then(unwrap)
    ).data,

  deleteCard: async (projectId: string, cardId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/kanban/projects/{projectId}/cards/{cardId}", {
      params: { path: { projectId, cardId } },
    });
  },

  // ---- Card relations ----
  addRelation: async (
    projectId: string,
    cardId: string,
    data: JsonBody<Op<`${P}/cards/{cardId}/relations`, "post">>,
  ): Promise<CardRelation[]> =>
    (
      await typedApi
        .POST("/api/v1/kanban/projects/{projectId}/cards/{cardId}/relations", {
          params: { path: { projectId, cardId } },
          body: data,
        })
        .then(unwrap)
    ).data,

  removeRelation: async (projectId: string, cardId: string, relationId: string): Promise<CardRelation[]> =>
    (
      await typedApi
        .DELETE("/api/v1/kanban/projects/{projectId}/cards/{cardId}/relations/{relationId}", {
          params: { path: { projectId, cardId, relationId } },
        })
        .then(unwrap)
    ).data,

  // ---- Labels ----
  createLabel: async (projectId: string, data: JsonBody<Op<`${P}/labels`, "post">>): Promise<KanbanLabel> =>
    (await typedApi.POST("/api/v1/kanban/projects/{projectId}/labels", { ...project(projectId), body: data }).then(unwrap)).data,

  updateLabel: async (
    projectId: string,
    labelId: string,
    data: JsonBody<Op<`${P}/labels/{labelId}`, "patch">>,
  ): Promise<KanbanLabel> =>
    (
      await typedApi
        .PATCH("/api/v1/kanban/projects/{projectId}/labels/{labelId}", {
          params: { path: { projectId, labelId } },
          body: data,
        })
        .then(unwrap)
    ).data,

  deleteLabel: async (projectId: string, labelId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/kanban/projects/{projectId}/labels/{labelId}", {
      params: { path: { projectId, labelId } },
    });
  },
};

export default kanbanService;
