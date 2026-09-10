"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Card, CardContent, Alert, Badge } from "@/components/ui";
import { Plus, KanbanSquare, Users } from "lucide-react";
import { useKanbanProjects } from "./hooks/useKanbanProjects";
import CreateProjectModal from "./components/CreateProjectModal";

export default function KanbanProjectsPage() {
  const {
    projects,
    isLoading,
    error,
    isCreateOpen,
    setIsCreateOpen,
    form,
    setForm,
    submitting,
    openCreate,
    handleCreate,
    openProject,
  } = useKanbanProjects();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              Kanban Boards
            </h1>
            <p className="text-muted-foreground mt-1">
              Track projects across your team. Each board has its own flow,
              sprints, and members.
            </p>
          </div>
          <Button
            variant="primary"
            leftIcon={<Plus className="h-5 w-5" />}
            onClick={openCreate}
          >
            New Board
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {isLoading && projects.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : projects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => openProject(p.id)}
                className="text-left group"
              >
                <Card className="h-full transition-all group-hover:shadow-lg group-hover:-translate-y-0.5">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <span
                        className="mt-1 h-10 w-10 rounded-xl flex items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: p.color || "#4f46e5" }}
                      >
                        <KanbanSquare className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-foreground truncate">
                            {p.name}
                          </h3>
                          {p.code && (
                            <Badge variant="secondary" size="sm">
                              {p.code}
                            </Badge>
                          )}
                        </div>
                        {p.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {p.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                          <span>{p.cardCount} cards</span>
                          {p.myAccess && (
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {p.myAccess}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-16 text-center">
              <KanbanSquare className="mx-auto h-16 w-16 text-muted-foreground" />
              <h3 className="text-xl font-semibold text-foreground mt-4">
                No boards yet
              </h3>
              <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                Create your first project board to start tracking work.
              </p>
              <Button
                variant="primary"
                leftIcon={<Plus className="h-5 w-5" />}
                onClick={openCreate}
                className="mt-6"
              >
                Create First Board
              </Button>
            </CardContent>
          </Card>
        )}

        <CreateProjectModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          form={form}
          setForm={setForm}
          onSubmit={handleCreate}
          submitting={submitting}
          error={error}
        />
      </div>
    </DashboardLayout>
  );
}
