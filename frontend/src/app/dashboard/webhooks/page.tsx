// src/app/dashboard/webhooks/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Alert, ConfirmDialog } from "@/components/ui";
import { Plus } from "lucide-react";
import { useWebhooks } from "./hooks/useWebhooks";
import WebhookModal from "./components/WebhookModal";
import WebhooksTable from "./components/WebhooksTable";
import DeleteWebhookModal from "./components/DeleteWebhookModal";
import DeliveriesPanel from "./components/DeliveriesPanel";
import SecretRevealDialog from "./components/SecretRevealDialog";

export default function WebhooksPage() {
  const {
    webhooks,
    isWebhooksLoading,
    webhooksError,
    isSubmitting,
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
  } = useWebhooks();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
            <p className="text-sm text-muted-foreground">
              Deliver event notifications to your systems in real time.
            </p>
          </div>
          <Button onClick={openCreateModal} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Webhook
          </Button>
        </div>

        {webhooksError && <Alert variant="error">{webhooksError}</Alert>}

        <WebhooksTable
          webhooks={webhooks}
          isWebhooksLoading={isWebhooksLoading}
          pageSize={pageSize}
          setCurrentPage={setCurrentPage}
          testingId={testingId}
          deliveriesWebhookId={deliveriesWebhook?.id ?? null}
          handleTestClick={handleTestClick}
          toggleDeliveries={toggleDeliveries}
          openEditModal={openEditModal}
          handleDeleteClick={handleDeleteClick}
          handleRotateClick={handleRotateClick}
        />

        {deliveriesWebhook && (
          <DeliveriesPanel
            webhook={deliveriesWebhook}
            deliveries={deliveries}
            isLoading={isDeliveriesLoading}
            error={deliveriesError}
            pageSize={deliveriesPageSize}
            setPage={setDeliveriesPage}
            onClose={closeDeliveries}
          />
        )}

        <WebhookModal
          isOpen={isWebhookModalOpen}
          onClose={closeWebhookModal}
          modalType={modalType}
          isLoading={isSubmitting}
          form={form}
          setForm={setForm}
          toggleEvent={toggleEvent}
          addEvent={addEvent}
          removeEvent={removeEvent}
          onSubmit={handleFormSubmit}
          originalUrl={modalType === "edit" ? selectedWebhook?.url : null}
        />

        <SecretRevealDialog
          revealed={revealedSecret}
          onCopy={copyRevealedSecret}
          onClose={closeSecretReveal}
        />

        <ConfirmDialog
          isOpen={webhookToRotate !== null}
          title="Rotate signing secret?"
          description={
            <>
              {webhookToRotate && (
                <code className="font-mono text-xs block max-w-full truncate mb-2">
                  {webhookToRotate.url}
                </code>
              )}
              A new secret is issued and the current one stops working
              immediately — there is no overlap. Deliveries will fail
              signature checks until the endpoint is updated with the new
              secret, which is shown only once.
            </>
          }
          confirmLabel="Rotate secret"
          variant="danger"
          isLoading={isRotating}
          onConfirm={confirmRotate}
          onCancel={cancelRotate}
        />

        <DeleteWebhookModal
          isOpen={isDeleteConfirmOpen}
          onClose={() => setIsDeleteConfirmOpen(false)}
          onConfirm={confirmDelete}
          isLoading={isSubmitting}
          webhook={webhookToDelete}
        />
      </div>
    </DashboardLayout>
  );
}
