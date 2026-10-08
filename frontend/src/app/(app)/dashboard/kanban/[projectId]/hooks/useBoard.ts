// src/app/dashboard/kanban/[projectId]/hooks/useBoard.ts
import { useEffect, useState, useCallback, useRef } from "react";
import { getSocket, joinBoardRoom } from "@/lib/socket";
import { useKanbanStore } from "@/stores/kanbanStore";
import {
  kanbanService,
  KanbanCard,
  KanbanColumn,
  KanbanSprint,
  CardRelation,
  CreateCardInput,
  UpdateCardInput,
  RelationType,
  AccessLevel,
} from "@/api/services/kanban.service";

/**
 * `kanban:card:relations` as backend/src/services/kanban.service.js emits it
 * (addRelation / removeRelation): the SOURCE card's id and its relations after
 * the change. The target card's mirror row changed too, but gets no event of
 * its own.
 */
export interface CardRelationsEvent {
  cardId: string;
  relations: CardRelation[];
}

export type CardRelationsListener = (event: CardRelationsEvent) => void;

export function useBoard(projectId: string) {
  const {
    board,
    isLoading,
    error,
    viewSprintId,
    fetchBoard,
    setViewSprint,
    upsertCard,
    removeCard,
    setColumns,
    upsertSprint,
    removeSprint,
    setBoard,
    setError,
  } = useKanbanStore();

  // Who wants `kanban:card:relations` (the open CardModal). The relations of a
  // card live in the modal's own state, not in the board, so the event is
  // fanned out to subscribers instead of patched into the store.
  const relationListeners = useRef(new Set<CardRelationsListener>());
  const subscribeCardRelations = useCallback(
    (listener: CardRelationsListener) => {
      const listeners = relationListeners.current;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [],
  );

  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  // WCAG 2.1.1 / 4.1.3: what a keyboard move did, for the page's live region.
  const [announcement, setAnnouncement] = useState("");

  const canEdit =
    board?.myAccess === "editor" || board?.myAccess === "owner";
  const isOwner = board?.myAccess === "owner";

  // Reload the board for whatever sprint is currently in view. Reads the live
  // view id from the store so it never closes over a stale value.
  const reload = useCallback(() => {
    const v = useKanbanStore.getState().viewSprintId;
    return fetchBoard(projectId, v || undefined);
  }, [projectId, fetchBoard]);

  // Initial load.
  useEffect(() => {
    fetchBoard(projectId);
  }, [projectId, fetchBoard]);

  // Realtime: join the board room and patch state on events.
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const socket = await getSocket();
      if (!socket || disposed) return;

      // Joined now AND after every reconnect (A-53); a refusal is shown, not
      // swallowed.
      const leaveRoom = joinBoardRoom(socket, projectId, (reason) =>
        setError(`Live updates are unavailable: ${reason}`),
      );

      const onCardCreated = (p: { card: KanbanCard }) => upsertCard(p.card);
      const onCardUpdated = (p: { card: KanbanCard }) => upsertCard(p.card);
      const onCardMoved = (p: { card: KanbanCard }) => upsertCard(p.card);
      const onCardDeleted = (p: { cardId: string }) => removeCard(p.cardId);
      const onColumns = () => reload();
      const onSprintCreated = (p: { sprint: KanbanSprint }) =>
        upsertSprint(p.sprint);
      const onSprintUpdated = (p: { sprint: KanbanSprint }) =>
        upsertSprint(p.sprint);
      const onSprintDeleted = (p: { sprintId: string }) =>
        removeSprint(p.sprintId);
      const onMigrated = () => reload();
      // F-19: labels, project metadata and card relations. Every label event
      // reloads: a renamed or deleted label is also embedded in the cards
      // that carry it (the join rows cascade on delete). A project update
      // (rename, members) reloads rather than applying the payload, because
      // the payload's myAccess is the ACTOR's, not this viewer's.
      const onLabels = () => reload();
      const onProjectUpdated = () => reload();
      const onProjectDeleted = () => {
        setBoard(null);
        setError("This board was deleted.");
      };
      const onCardRelations = (p: CardRelationsEvent) =>
        relationListeners.current.forEach((listener) => listener(p));

      socket.on("kanban:card:created", onCardCreated);
      socket.on("kanban:card:updated", onCardUpdated);
      socket.on("kanban:card:moved", onCardMoved);
      socket.on("kanban:card:deleted", onCardDeleted);
      socket.on("kanban:column:created", onColumns);
      socket.on("kanban:column:updated", onColumns);
      socket.on("kanban:column:deleted", onColumns);
      socket.on("kanban:column:reordered", onColumns);
      socket.on("kanban:sprint:created", onSprintCreated);
      socket.on("kanban:sprint:updated", onSprintUpdated);
      socket.on("kanban:sprint:deleted", onSprintDeleted);
      socket.on("kanban:cards:migrated", onMigrated);
      socket.on("kanban:label:created", onLabels);
      socket.on("kanban:label:updated", onLabels);
      socket.on("kanban:label:deleted", onLabels);
      socket.on("kanban:project:updated", onProjectUpdated);
      socket.on("kanban:project:deleted", onProjectDeleted);
      socket.on("kanban:card:relations", onCardRelations);

      cleanup = () => {
        leaveRoom();
        socket.off("kanban:card:created", onCardCreated);
        socket.off("kanban:card:updated", onCardUpdated);
        socket.off("kanban:card:moved", onCardMoved);
        socket.off("kanban:card:deleted", onCardDeleted);
        socket.off("kanban:column:created", onColumns);
        socket.off("kanban:column:updated", onColumns);
        socket.off("kanban:column:deleted", onColumns);
        socket.off("kanban:column:reordered", onColumns);
        socket.off("kanban:sprint:created", onSprintCreated);
        socket.off("kanban:sprint:updated", onSprintUpdated);
        socket.off("kanban:sprint:deleted", onSprintDeleted);
        socket.off("kanban:cards:migrated", onMigrated);
        socket.off("kanban:label:created", onLabels);
        socket.off("kanban:label:updated", onLabels);
        socket.off("kanban:label:deleted", onLabels);
        socket.off("kanban:project:updated", onProjectUpdated);
        socket.off("kanban:project:deleted", onProjectDeleted);
        socket.off("kanban:card:relations", onCardRelations);
      };
    })();

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, [
    projectId,
    reload,
    upsertCard,
    removeCard,
    upsertSprint,
    removeSprint,
    setBoard,
    setError,
  ]);

  // ---- Card actions ----
  const createCard = async (data: CreateCardInput) => {
    setError(null);
    const card = await kanbanService.createCard(projectId, data);
    upsertCard(card);
    return card;
  };

  const updateCard = async (cardId: string, data: UpdateCardInput) => {
    setError(null);
    const card = await kanbanService.updateCard(projectId, cardId, data);
    upsertCard(card);
    return card;
  };

  const deleteCard = async (cardId: string) => {
    await kanbanService.deleteCard(projectId, cardId);
    removeCard(cardId);
  };

  /** Move a card; resolves true when the server accepted it. */
  const moveCard = async (
    cardId: string,
    columnId: string,
    position: number,
  ): Promise<boolean> => {
    // Optimistic local move so the UI feels instant.
    if (board) {
      const card = board.cards.find((c) => c.id === cardId);
      if (card) upsertCard({ ...card, columnId, position });
    }
    try {
      const updated = await kanbanService.moveCard(projectId, cardId, {
        columnId,
        position,
      });
      upsertCard(updated);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to move card";
      // Reload first: fetchBoard clears the error as it starts, so an error
      // set before the reload was wiped before anyone could read it.
      await reload();
      setError(message);
      return false;
    }
  };

  /**
   * WCAG 2.1.1 — the keyboard path to what drag and drop does: move a card to
   * the end of another column, then announce the result (the page renders
   * `announcement` in a polite live region; a failure shows the error alert).
   */
  const moveCardToColumn = async (cardId: string, columnId: string) => {
    if (!board) return;
    const card = board.cards.find((c) => c.id === cardId);
    const column = board.columns.find((c) => c.id === columnId);
    if (!card || !column || card.columnId === columnId) return;
    const position = board.cards.filter((c) => c.columnId === columnId && c.id !== cardId).length;
    setAnnouncement("");
    const moved = await moveCard(cardId, columnId, position);
    if (moved) setAnnouncement(`Moved "${card.title}" to ${column.name}.`);
  };

  // ---- Drag & drop (native HTML5) ----
  const onCardDragStart = (cardId: string) => setDraggingCardId(cardId);
  const onCardDragEnd = () => setDraggingCardId(null);

  const onDropInColumn = (columnId: string, beforeCardId?: string) => {
    if (!draggingCardId || !board) return;
    const colCards = board.cards
      .filter((c) => c.columnId === columnId && c.id !== draggingCardId)
      .sort((a, b) => a.position - b.position);
    let position = colCards.length;
    if (beforeCardId) {
      const idx = colCards.findIndex((c) => c.id === beforeCardId);
      if (idx >= 0) position = idx;
    }
    moveCard(draggingCardId, columnId, position);
    setDraggingCardId(null);
  };

  // ---- Column actions ----
  const createColumn = async (name: string) => {
    await kanbanService.createColumn(projectId, { name });
    reload();
  };
  const renameColumn = async (columnId: string, name: string) => {
    await kanbanService.updateColumn(projectId, columnId, { name });
    reload();
  };
  const deleteColumn = async (columnId: string) => {
    await kanbanService.deleteColumn(projectId, columnId);
    reload();
  };
  const reorderColumns = async (order: string[]) => {
    const cols = await kanbanService.reorderColumns(projectId, order);
    setColumns(cols);
  };

  // ---- Label actions ----
  const createLabel = async (name: string, color: string) => {
    await kanbanService.createLabel(projectId, { name, color });
    reload();
  };
  const deleteLabel = async (labelId: string) => {
    await kanbanService.deleteLabel(projectId, labelId);
    reload();
  };

  // ---- Sprint actions ----
  const createSprint = async (name: string, goal: string) => {
    await kanbanService.createSprint(projectId, { name, goal });
  };
  const updateSprint = async (
    sprintId: string,
    data: Partial<{ name: string; goal: string; status: KanbanSprint["status"] }>,
  ) => {
    await kanbanService.updateSprint(projectId, sprintId, data);
  };
  const deleteSprint = async (sprintId: string) => {
    await kanbanService.deleteSprint(projectId, sprintId);
    if (viewSprintId === sprintId) setViewSprint(projectId, "backlog");
  };
  const migrateCards = async (data: {
    cardIds?: string[];
    allNotDone?: boolean;
    fromSprintId?: string | null;
    targetSprintId: string | null;
  }) => {
    const res = await kanbanService.migrateCards(projectId, data);
    reload();
    return res;
  };

  // ---- Relation actions ----
  const addRelation = (
    cardId: string,
    targetCardId: string,
    type: RelationType,
  ) => kanbanService.addRelation(projectId, cardId, { targetCardId, type });
  const removeRelation = (cardId: string, relationId: string) =>
    kanbanService.removeRelation(projectId, cardId, relationId);

  // ---- Member actions ----
  const addMember = async (
    subject: { userId?: string; roleId?: string },
    accessLevel: AccessLevel,
  ) => {
    await kanbanService.addMember(projectId, { ...subject, accessLevel });
    reload();
  };
  const updateMember = async (memberId: string, accessLevel: AccessLevel) => {
    await kanbanService.updateMember(projectId, memberId, accessLevel);
    reload();
  };
  const removeMember = async (memberId: string) => {
    await kanbanService.removeMember(projectId, memberId);
    reload();
  };

  const columnsSorted: KanbanColumn[] = (board?.columns || [])
    .slice()
    .sort((a, b) => a.position - b.position);

  const cardsByColumn = (columnId: string): KanbanCard[] =>
    (board?.cards || [])
      .filter((c) => c.columnId === columnId)
      .sort((a, b) => a.position - b.position);

  return {
    board,
    isLoading,
    error,
    setError,
    canEdit,
    isOwner,
    viewSprintId,
    setViewSprint: (sprintId: string) => setViewSprint(projectId, sprintId),
    refetch: () => fetchBoard(projectId, viewSprintId || undefined),
    columnsSorted,
    cardsByColumn,
    // cards
    createCard,
    updateCard,
    deleteCard,
    moveCard,
    moveCardToColumn,
    announcement,
    // dnd
    draggingCardId,
    onCardDragStart,
    onCardDragEnd,
    onDropInColumn,
    // columns
    createColumn,
    renameColumn,
    deleteColumn,
    reorderColumns,
    // labels
    createLabel,
    deleteLabel,
    // sprints
    createSprint,
    updateSprint,
    deleteSprint,
    migrateCards,
    // relations
    addRelation,
    removeRelation,
    subscribeCardRelations,
    // members
    addMember,
    updateMember,
    removeMember,
  };
}

export default useBoard;
