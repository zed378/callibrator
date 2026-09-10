// src/app/dashboard/webhooks/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Alert } from "@/components/ui";
import { Plus } from "lucide-react";
import { useWebhooks } from "./hooks/useWebhooks";
import WebhookModal from "./components/WebhookModal";
import WebhooksTable from "./components/WebhooksTable";
import DeleteWebhookModal from "./components/DeleteWebhookModal";
import DeliveriesPanel from "./components/DeliveriesPanel";

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
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
    webhookToDelete,
    createdSecret,
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
    copyCreatedSecret,
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
          createdSecret={createdSecret}
          onCopySecret={copyCreatedSecret}
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
