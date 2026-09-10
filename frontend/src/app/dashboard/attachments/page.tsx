// src/app/dashboard/attachments/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Alert, Select } from "@/components/ui";
import { UploadCloud } from "lucide-react";
import { useAttachments } from "./hooks/useAttachments";
import AttachmentsTable from "./components/AttachmentsTable";
import UploadAttachmentModal from "./components/UploadAttachmentModal";
import DeleteAttachmentModal from "./components/DeleteAttachmentModal";

const FILTER_OPTIONS = [
  { value: "", label: "All files" },
  { value: "generic", label: "General / Unlinked" },
  { value: "device", label: "Device" },
  { value: "certificate", label: "Certificate" },
  { value: "workorder", label: "Work Order" },
  { value: "calibration", label: "Calibration Record" },
];

export default function AttachmentsPage() {
  const {
    attachments,
    isLoading,
    error,
    isSubmitting,
    setCurrentPage,
    pageSize,
    resourceTypeFilter,
    setResourceTypeFilter,
    isUploadModalOpen,
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
    attachmentToDelete,
    downloadingId,
    form,
    setForm,
    file,
    setFile,
    openUploadModal,
    closeUploadModal,
    handleUploadSubmit,
    handleDownload,
    handleDeleteClick,
    confirmDelete,
  } = useAttachments();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Files &amp; Documents
            </h1>
            <p className="text-sm text-muted-foreground">
              Upload, download, and manage tenant files, evidence, and documents.
            </p>
          </div>
          <Button onClick={openUploadModal} className="flex items-center gap-2">
            <UploadCloud className="h-4 w-4" />
            Upload File
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex justify-start">
          <div className="w-full sm:w-64">
            <Select
              value={resourceTypeFilter}
              onChange={(value) => {
                setResourceTypeFilter(value);
                setCurrentPage(1);
              }}
              options={FILTER_OPTIONS}
            />
          </div>
        </div>

        <AttachmentsTable
          attachments={attachments}
          isLoading={isLoading}
          pageSize={pageSize}
          downloadingId={downloadingId}
          setCurrentPage={setCurrentPage}
          onDownload={handleDownload}
          onDelete={handleDeleteClick}
        />

        <UploadAttachmentModal
          isOpen={isUploadModalOpen}
          onClose={closeUploadModal}
          isLoading={isSubmitting}
          form={form}
          setForm={setForm}
          file={file}
          setFile={setFile}
          onSubmit={handleUploadSubmit}
        />

        <DeleteAttachmentModal
          isOpen={isDeleteConfirmOpen}
          onClose={() => setIsDeleteConfirmOpen(false)}
          onConfirm={confirmDelete}
          isLoading={isSubmitting}
          attachment={attachmentToDelete}
        />
      </div>
    </DashboardLayout>
  );
}
