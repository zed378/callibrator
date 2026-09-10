// src/app/dashboard/api-keys/hooks/useApiKeys.ts
import { useCallback, useEffect, useState } from "react";
import { useToastStore } from "@/stores/toastStore";
import {
  ApiKey,
  ApiKeyCreateInput,
  apiKeyService,
} from "@/api/services/apiKey.service";
import { PaginatedResponse } from "@/types";

export interface ApiKeyFormState {
  name: string;
  scopes: string[];
  expiresAt: string; // yyyy-mm-dd from the date input; "" = never
}

const emptyForm: ApiKeyFormState = {
  name: "",
  scopes: [],
  expiresAt: "",
};

export function useApiKeys() {
  const { addToast } = useToastStore();

  // Data state
  const [apiKeys, setApiKeys] = useState<PaginatedResponse<ApiKey> | null>(
    null,
  );
  const [isApiKeysLoading, setIsApiKeysLoading] = useState(true);
  const [apiKeysError, setApiKeysError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

  // Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isRevokeConfirmOpen, setIsRevokeConfirmOpen] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);

  // Create-flow: raw key revealed exactly once after creation.
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState<ApiKeyFormState>(emptyForm);

  const fetchApiKeys = useCallback(async () => {
    setIsApiKeysLoading(true);
    setApiKeysError(null);
    try {
      const result = await apiKeyService.getAll(currentPage, pageSize);
      setApiKeys(result);
    } catch (err) {
      setApiKeysError(
        err instanceof Error ? err.message : "Failed to load API keys",
      );
    } finally {
      setIsApiKeysLoading(false);
    }
  }, [currentPage, pageSize]);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  const openCreateModal = () => {
    setForm(emptyForm);
    setCreatedKey(null);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    // If a key was just created, refresh the list on close.
    const shouldRefresh = createdKey !== null;
    setIsCreateModalOpen(false);
    setCreatedKey(null);
    setForm(emptyForm);
    if (shouldRefresh) fetchApiKeys();
  };

  const addScope = (scope: string) => {
    const trimmed = scope.trim();
    if (!trimmed) return;
    setForm((prev) =>
      prev.scopes.includes(trimmed)
        ? prev
        : { ...prev, scopes: [...prev.scopes, trimmed] },
    );
  };

  const removeScope = (scope: string) => {
    setForm((prev) => ({
      ...prev,
      scopes: prev.scopes.filter((s) => s !== scope),
    }));
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.scopes.length === 0) {
      addToast({ type: "error", title: "Add at least one scope" });
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: ApiKeyCreateInput = {
        name: form.name.trim(),
        scopes: form.scopes,
      };
      if (form.expiresAt) {
        payload.expiresAt = new Date(form.expiresAt).toISOString();
      }
      const created = await apiKeyService.create(payload);
      setCreatedKey(created.key);
      addToast({ type: "success", title: "API key created" });
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to create API key",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevokeClick = (apiKey: ApiKey) => {
    setKeyToRevoke(apiKey);
    setIsRevokeConfirmOpen(true);
  };

  const confirmRevoke = async () => {
    if (!keyToRevoke) return;
    setIsSubmitting(true);
    try {
      await apiKeyService.revoke(keyToRevoke.id);
      addToast({ type: "success", title: "API key revoked" });
      setIsRevokeConfirmOpen(false);
      setKeyToRevoke(null);
      fetchApiKeys();
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to revoke API key",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyCreatedKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      addToast({ type: "success", title: "API key copied to clipboard" });
    } catch {
      addToast({ type: "error", title: "Failed to copy — copy it manually" });
    }
  };

  return {
    apiKeys,
    isApiKeysLoading,
    apiKeysError,
    isSubmitting,
    currentPage,
    setCurrentPage,
    pageSize,
    isCreateModalOpen,
    isRevokeConfirmOpen,
    setIsRevokeConfirmOpen,
    keyToRevoke,
    createdKey,
    form,
    setForm,
    addScope,
    removeScope,
    openCreateModal,
    closeCreateModal,
    handleCreateSubmit,
    handleRevokeClick,
    confirmRevoke,
    copyCreatedKey,
  };
}

export default useApiKeys;
