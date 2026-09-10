"use client";

import React, { useState, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Badge, Alert, ConfirmDialog } from "@/components/ui";
import {
  ArrowLeft,
  Users,
  Settings2,
  KanbanSquare,
  BarChart3,
} from "lucide-react";
import { useBoard } from "./hooks/useBoard";
import BoardColumn from "./components/BoardColumn";
import CardModal from "./components/CardModal";
import SprintBar from "./components/SprintBar";
import MigrateModal from "./components/MigrateModal";
import ManageBoardModal from "./components/ManageBoardModal";
import MembersModal from "./components/MembersModal";
import NewSprintModal from "./components/NewSprintModal";

function KanbanBoardContent() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.projectId);
  const b = useBoard(projectId);

  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showNewSprint, setShowNewSprint] = useState(false);
  const [sprintToDelete, setSprintToDelete] = useState<string | null>(null);

  const { board } = b;
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/dashboard/kanban")}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Boards
          </Button>
        </div>

        {b.error && <Alert variant="error">{b.error}</Alert>}

        {!board ? (
          <div className="text-sm text-muted-foreground">
            {b.isLoading ? "Loading board…" : "Board not found."}
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-3">
                <span
                  className="h-10 w-10 rounded-xl flex items-center justify-center text-white"
                  style={{ backgroundColor: board.color || "#4f46e5" }}
                >
                  <KanbanSquare className="h-5 w-5" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                      {board.name}
                    </h1>
                    {board.code && (
                      <Badge variant="secondary" size="sm">
                        {board.code}
                      </Badge>
                    )}
                  </div>
                  {board.description && (
                    <p className="text-sm text-muted-foreground">
                      {board.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    router.push(`/dashboard/kanban/${projectId}/dashboard`)
                  }
                  leftIcon={<BarChart3 className="h-4 w-4" />}
                >
                  Analytics
                </Button>
                {b.isOwner && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowMembers(true)}
                      leftIcon={<Users className="h-4 w-4" />}
                    >
                      Members
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowManage(true)}
                      leftIcon={<Settings2 className="h-4 w-4" />}
                    >
                      Manage
                    </Button>
                  </>
                )}
              </div>
            </div>

            <SprintBar
              board={board}
              viewSprintId={b.viewSprintId}
              canEdit={b.canEdit}
              isOwner={b.isOwner}
              onSelect={b.setViewSprint}
              onNewSprint={() => setShowNewSprint(true)}
              onMigrate={() => setShowMigrate(true)}
              onSetStatus={(id, status) => b.updateSprint(id, { status })}
              onDeleteSprint={(id) => setSprintToDelete(id)}
            />

            {/* Board */}
            <div className="flex gap-3 overflow-x-auto pb-4">
              {b.columnsSorted.map((col) => (
                <BoardColumn
                  key={col.id}
                  column={col}
                  cards={b.cardsByColumn(col.id)}
                  canEdit={b.canEdit}
                  draggingCardId={b.draggingCardId}
                  onOpenCard={setOpenCardId}
                  onCardDragStart={b.onCardDragStart}
                  onCardDragEnd={b.onCardDragEnd}
                  onDropInColumn={b.onDropInColumn}
                  onQuickAdd={(columnId, title) =>
                    b.createCard({ columnId, title })
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>

      {board && (
        <>
          <CardModal
            isOpen={!!openCardId}
            projectId={projectId}
            cardId={openCardId}
            board={board}
            canEdit={b.canEdit}
            onClose={() => setOpenCardId(null)}
            onSaved={b.refetch}
            onDeleted={() => setOpenCardId(null)}
          />
          <MigrateModal
            isOpen={showMigrate}
            board={board}
            viewSprintId={b.viewSprintId}
            onClose={() => setShowMigrate(false)}
            onMigrate={b.migrateCards}
          />
          <ManageBoardModal
            isOpen={showManage}
            board={board}
            onClose={() => setShowManage(false)}
            onCreateColumn={b.createColumn}
            onRenameColumn={b.renameColumn}
            onDeleteColumn={b.deleteColumn}
            onReorderColumns={b.reorderColumns}
            onCreateLabel={b.createLabel}
            onDeleteLabel={b.deleteLabel}
          />
          <MembersModal
            isOpen={showMembers}
            board={board}
            onClose={() => setShowMembers(false)}
            onAdd={b.addMember}
            onUpdate={b.updateMember}
            onRemove={b.removeMember}
          />
          <NewSprintModal
            isOpen={showNewSprint}
            onClose={() => setShowNewSprint(false)}
            onCreate={b.createSprint}
          />
          <ConfirmDialog
            isOpen={sprintToDelete !== null}
            title="Delete this sprint?"
            description="Its cards are not deleted — they move back to the backlog."
            confirmLabel="Delete sprint"
            onCancel={() => setSprintToDelete(null)}
            onConfirm={() => {
              if (sprintToDelete) b.deleteSprint(sprintToDelete);
              setSprintToDelete(null);
            }}
          />
        </>
      )}
    </DashboardLayout>
  );
}

export default function KanbanBoardPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <KanbanBoardContent />
    </Suspense>
  );
}
