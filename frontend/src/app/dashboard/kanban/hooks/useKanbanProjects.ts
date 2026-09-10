// src/app/dashboard/kanban/hooks/useKanbanProjects.ts
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useKanbanStore } from "@/stores/kanbanStore";
import {
  MemberInput,
  CreateProjectInput,
} from "@/api/services/kanban.service";

export function useKanbanProjects() {
  const router = useRouter();
  const { projects, isLoading, error, fetchProjects, createProject, setError } =
    useKanbanStore();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    code: string;
    description: string;
    color: string;
    members: MemberInput[];
  }>({
    name: "",
    code: "",
    description: "",
    color: "#4f46e5",
    members: [],
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const openCreate = () => {
    setForm({
      name: "",
      code: "",
      description: "",
      color: "#4f46e5",
      members: [],
    });
    setError(null);
    setIsCreateOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateProjectInput = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        description: form.description.trim() || null,
        color: form.color || null,
        members: form.members,
      };
      const board = await createProject(payload);
      setIsCreateOpen(false);
      router.push(`/dashboard/kanban/${board.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  };

  const openProject = (id: string) => router.push(`/dashboard/kanban/${id}`);

  return {
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
  };
}

export default useKanbanProjects;
