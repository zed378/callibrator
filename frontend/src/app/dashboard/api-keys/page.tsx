// src/app/dashboard/api-keys/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Alert } from "@/components/ui";
import { Plus } from "lucide-react";
import { useApiKeys } from "./hooks/useApiKeys";
import CreateApiKeyModal from "./components/CreateApiKeyModal";
import ApiKeysTable from "./components/ApiKeysTable";
import RevokeApiKeyModal from "./components/RevokeApiKeyModal";

export default function ApiKeysPage() {
  const {
    apiKeys,
    isApiKeysLoading,
    apiKeysError,
    isSubmitting,
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
  } = useApiKeys();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
            <p className="text-sm text-muted-foreground">
              Manage machine-to-machine keys for external integrations.
            </p>
          </div>
          <Button onClick={openCreateModal} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create API Key
          </Button>
        </div>

        {apiKeysError && <Alert variant="error">{apiKeysError}</Alert>}

        <ApiKeysTable
          apiKeys={apiKeys}
          isApiKeysLoading={isApiKeysLoading}
          pageSize={pageSize}
          setCurrentPage={setCurrentPage}
          handleRevokeClick={handleRevokeClick}
        />

        <CreateApiKeyModal
          isOpen={isCreateModalOpen}
          onClose={closeCreateModal}
          isLoading={isSubmitting}
          form={form}
          setForm={setForm}
          addScope={addScope}
          removeScope={removeScope}
          onSubmit={handleCreateSubmit}
          createdKey={createdKey}
          onCopyKey={copyCreatedKey}
        />

        <RevokeApiKeyModal
          isOpen={isRevokeConfirmOpen}
          onClose={() => setIsRevokeConfirmOpen(false)}
          onConfirm={confirmRevoke}
          isLoading={isSubmitting}
          apiKey={keyToRevoke}
        />
      </div>
    </DashboardLayout>
  );
}
