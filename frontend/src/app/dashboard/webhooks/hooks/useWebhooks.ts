// src/app/dashboard/webhooks/hooks/useWebhooks.ts
import { useCallback, useEffect, useState } from "react";
import { useToastStore } from "@/stores/toastStore";
import {
  Webhook,
  WebhookCreateInput,
  WebhookDelivery,
  webhookService,
} from "@/api/services/webhook.service";
import { PaginatedResponse } from "@/types";

/** Why a signing secret is being shown — decides the dialog's wording. */
export type SecretRevealReason = "created" | "rotated" | "url_changed";

/**
 * A signing secret the backend returned once (A-51). It lives only in this
 * state until the reveal dialog closes, and is never fetched again.
 */
export interface RevealedSecret {
  secret: string;
  reason: SecretRevealReason;
  webhookUrl: string;
}

export interface WebhookFormState {
  url: string;
  events: string[];
  description: string;
  isActive: boolean;
}

const emptyForm: WebhookFormState = {
  url: "",
  events: [],
  description: "",
  isActive: true,
};

export function useWebhooks() {
  const { addToast } = useToastStore();

  // Data state
  const [webhooks, setWebhooks] = useState<PaginatedResponse<Webhook> | null>(
    null,
  );
  const [isWebhooksLoading, setIsWebhooksLoading] = useState(true);
  const [webhooksError, setWebhooksError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

  // Modal state
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"create" | "edit">("create");
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [webhookToDelete, setWebhookToDelete] = useState<Webhook | null>(null);

  // Signing secret revealed exactly once — after create, rotate, or a url
  // change. Cleared when the reveal dialog closes.
  const [revealedSecret, setRevealedSecret] = useState<RevealedSecret | null>(
    null,
  );

  // Rotate-secret confirmation
  const [webhookToRotate, setWebhookToRotate] = useState<Webhook | null>(null);
  const [isRotating, setIsRotating] = useState(false);

  // Test action
  const [testingId, setTestingId] = useState<string | null>(null);

  // Deliveries panel
  const [deliveriesWebhook, setDeliveriesWebhook] = useState<Webhook | null>(
    null,
  );
  const [deliveries, setDeliveries] =
    useState<PaginatedResponse<WebhookDelivery> | null>(null);
  const [isDeliveriesLoading, setIsDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);
  const [deliveriesPage, setDeliveriesPage] = useState(1);
  const [deliveriesPageSize] = useState(10);

  // Form state
  const [form, setForm] = useState<WebhookFormState>(emptyForm);

  const fetchWebhooks = useCallback(async () => {
    setIsWebhooksLoading(true);
    setWebhooksError(null);
    try {
      const result = await webhookService.getAll(currentPage, pageSize);
      setWebhooks(result);
    } catch (err) {
      setWebhooksError(
        err instanceof Error ? err.message : "Failed to load webhooks",
      );
    } finally {
      setIsWebhooksLoading(false);
    }
  }, [currentPage, pageSize]);

  useEffect(() => {
    // Defer past the synchronous effect body: fetchWebhooks writes state, and doing
    // that synchronously in an effect cascades renders
    // (react-hooks/set-state-in-effect). Same pattern as useNotifications.
    let active = true;
    (async () => {
      await Promise.resolve();
      if (active) await fetchWebhooks();
    })();
    return () => {
      active = false;
    };
  }, [fetchWebhooks]);

  const fetchDeliveries = useCallback(async () => {
    if (!deliveriesWebhook) return;
    setIsDeliveriesLoading(true);
    setDeliveriesError(null);
    try {
      const result = await webhookService.getDeliveries(
        deliveriesWebhook.id,
        deliveriesPage,
        deliveriesPageSize,
      );
      setDeliveries(result);
    } catch (err) {
      setDeliveriesError(
        err instanceof Error ? err.message : "Failed to load deliveries",
      );
    } finally {
      setIsDeliveriesLoading(false);
    }
  }, [deliveriesWebhook, deliveriesPage, deliveriesPageSize]);

  useEffect(() => {
    // Defer past the synchronous effect body: fetchDeliveries writes state, and doing
    // that synchronously in an effect cascades renders
    // (react-hooks/set-state-in-effect). Same pattern as useNotifications.
    let active = true;
    (async () => {
      await Promise.resolve();
      if (active) await fetchDeliveries();
    })();
    return () => {
      active = false;
    };
  }, [fetchDeliveries]);

  const toggleDeliveries = (webhook: Webhook) => {
    if (deliveriesWebhook?.id === webhook.id) {
      setDeliveriesWebhook(null);
      setDeliveries(null);
    } else {
      setDeliveries(null);
      setDeliveriesPage(1);
      setDeliveriesWebhook(webhook);
    }
  };

  const closeDeliveries = () => {
    setDeliveriesWebhook(null);
    setDeliveries(null);
  };

  const openCreateModal = () => {
    setForm(emptyForm);
    setModalType("create");
    setSelectedWebhook(null);
    setIsWebhookModalOpen(true);
  };

  const openEditModal = (webhook: Webhook) => {
    setForm({
      url: webhook.url,
      events: webhook.events || [],
      description: webhook.description || "",
      isActive: webhook.isActive,
    });
    setModalType("edit");
    setSelectedWebhook(webhook);
    setIsWebhookModalOpen(true);
  };

  const closeWebhookModal = () => {
    setIsWebhookModalOpen(false);
    setForm(emptyForm);
  };

  // The secret is dropped from memory here; the list is refreshed because
  // every path that reveals a secret has also changed a row.
  const closeSecretReveal = () => {
    setRevealedSecret(null);
    fetchWebhooks();
  };

  const toggleEvent = (event: string) => {
    setForm((prev) =>
      prev.events.includes(event)
        ? { ...prev, events: prev.events.filter((e) => e !== event) }
        : { ...prev, events: [...prev.events, event] },
    );
  };

  const addEvent = (event: string) => {
    const trimmed = event.trim();
    if (!trimmed) return;
    setForm((prev) =>
      prev.events.includes(trimmed)
        ? prev
        : { ...prev, events: [...prev.events, trimmed] },
    );
  };

  const removeEvent = (event: string) => {
    setForm((prev) => ({
      ...prev,
      events: prev.events.filter((e) => e !== event),
    }));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.events.length === 0) {
      addToast({ type: "error", title: "Select at least one event" });
      return;
    }
    setIsSubmitting(true);
    try {
      if (modalType === "create") {
        const payload: WebhookCreateInput = {
          url: form.url.trim(),
          events: form.events,
          description: form.description.trim() || undefined,
        };
        const created = await webhookService.create(payload);
        setIsWebhookModalOpen(false);
        setForm(emptyForm);
        setRevealedSecret({
          secret: created.secret,
          reason: "created",
          webhookUrl: created.url,
        });
        addToast({ type: "success", title: "Webhook created" });
      } else if (modalType === "edit" && selectedWebhook) {
        const updated = await webhookService.update(selectedWebhook.id, {
          url: form.url.trim(),
          events: form.events,
          description: form.description.trim() || undefined,
          isActive: form.isActive,
        });
        setIsWebhookModalOpen(false);
        setForm(emptyForm);
        if (updated.secret) {
          // The url changed, so the backend rotated the secret (A-51).
          setRevealedSecret({
            secret: updated.secret,
            reason: "url_changed",
            webhookUrl: updated.url,
          });
          addToast({
            type: "success",
            title: "Webhook updated — new signing secret issued",
          });
        } else {
          addToast({ type: "success", title: "Webhook updated" });
          fetchWebhooks();
        }
      }
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to save webhook",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (webhook: Webhook) => {
    setWebhookToDelete(webhook);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!webhookToDelete) return;
    setIsSubmitting(true);
    try {
      await webhookService.delete(webhookToDelete.id);
      addToast({ type: "success", title: "Webhook deleted" });
      setIsDeleteConfirmOpen(false);
      if (deliveriesWebhook?.id === webhookToDelete.id) {
        closeDeliveries();
      }
      setWebhookToDelete(null);
      fetchWebhooks();
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to delete webhook",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestClick = async (webhook: Webhook) => {
    setTestingId(webhook.id);
    try {
      const result = await webhookService.test(webhook.id);
      const ok = result.status === "success";
      addToast({
        type: ok ? "success" : "error",
        title: ok
          ? `Test delivered (HTTP ${result.responseStatus ?? "?"})`
          : `Test ${result.status}${
              result.responseStatus ? ` (HTTP ${result.responseStatus})` : ""
            }${result.lastError ? `: ${result.lastError}` : ""}`,
      });
      // Refresh deliveries panel if it is open for this webhook.
      if (deliveriesWebhook?.id === webhook.id) {
        fetchDeliveries();
      }
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to send test",
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleRotateClick = (webhook: Webhook) => {
    setWebhookToRotate(webhook);
  };

  const cancelRotate = () => {
    if (isRotating) return;
    setWebhookToRotate(null);
  };

  const confirmRotate = async () => {
    if (!webhookToRotate) return;
    setIsRotating(true);
    try {
      const rotated = await webhookService.rotateSecret(webhookToRotate.id);
      setWebhookToRotate(null);
      setRevealedSecret({
        secret: rotated.secret,
        reason: "rotated",
        webhookUrl: rotated.url,
      });
      addToast({ type: "success", title: "Signing secret rotated" });
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to rotate secret",
      });
    } finally {
      setIsRotating(false);
    }
  };

  const copyRevealedSecret = async () => {
    if (!revealedSecret) return;
    try {
      await navigator.clipboard.writeText(revealedSecret.secret);
      addToast({ type: "success", title: "Secret copied to clipboard" });
    } catch {
      addToast({ type: "error", title: "Failed to copy — copy it manually" });
    }
  };

  return {
    webhooks,
    isWebhooksLoading,
    webhooksError,
    isSubmitting,
    currentPage,
    setCurrentPage,
    pageSize,
    isWebhookModalOpen,
    modalType,
    selectedWebhook,
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
    webhookToDelete,
    revealedSecret,
    closeSecretReveal,
    webhookToRotate,
    isRotating,
    handleRotateClick,
    cancelRotate,
    confirmRotate,
    testingId,
    deliveriesWebhook,
    deliveries,
    isDeliveriesLoading,
    deliveriesError,
    deliveriesPage,
    setDeliveriesPage,
    deliveriesPageSize,
    form,
    setForm,
    toggleEvent,
    addEvent,
    removeEvent,
    openCreateModal,
    openEditModal,
    closeWebhookModal,
    handleFormSubmit,
    handleDeleteClick,
    confirmDelete,
    handleTestClick,
    toggleDeliveries,
    closeDeliveries,
    copyRevealedSecret,
  };
}

export default useWebhooks;
