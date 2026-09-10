// src/app/dashboard/attachments/hooks/useAttachments.ts
import { useCallback, useEffect, useState } from "react";
import { useToastStore } from "@/stores/toastStore";
import {
  Attachment,
  attachmentService,
} from "@/api/services/attachment.service";
import { PaginatedResponse } from "@/types";

export interface AttachmentFormState {
  resourceType: string;
  resourceId: string;
}

const emptyForm: AttachmentFormState = {
  resourceType: "generic",
  resourceId: "",
};

export function useAttachments() {
  const { addToast } = useToastStore();

  // Data state
  const [attachments, setAttachments] =
    useState<PaginatedResponse<Attachment> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pagination + filter
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  const [resourceTypeFilter, setResourceTypeFilter] = useState<string>("");

  // Modal state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [attachmentToDelete, setAttachmentToDelete] =
    useState<Attachment | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Upload form
  const [form, setForm] = useState<AttachmentFormState>(emptyForm);
  const [file, setFile] = useState<File | null>(null);

  const fetchAttachments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await attachmentService.getAll(currentPage, pageSize, {
        resourceType: resourceTypeFilter || undefined,
      });
      setAttachments(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load attachments",
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, resourceTypeFilter]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  const openUploadModal = () => {
    setForm(emptyForm);
    setFile(null);
    setIsUploadModalOpen(true);
  };

  const closeUploadModal = () => {
    setIsUploadModalOpen(false);
    setForm(emptyForm);
    setFile(null);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      addToast({ type: "error", title: "Choose a file to upload" });
      return;
    }
    setIsSubmitting(true);
    try {
      await attachmentService.upload({
        file,
        resourceType: form.resourceType.trim() || "generic",
        resourceId: form.resourceId.trim() || undefined,
      });
      addToast({ type: "success", title: "File uploaded" });
      closeUploadModal();
      fetchAttachments();
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to upload file",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownload = async (attachment: Attachment) => {
    setDownloadingId(attachment.id);
    try {
      const { url } = await attachmentService.getSignedUrl(attachment.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      addToast({
        type: "error",
        title:
          err instanceof Error ? err.message : "Failed to generate download link",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteClick = (attachment: Attachment) => {
    setAttachmentToDelete(attachment);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!attachmentToDelete) return;
    setIsSubmitting(true);
    try {
      await attachmentService.remove(attachmentToDelete.id);
      addToast({ type: "success", title: "Attachment deleted" });
      setIsDeleteConfirmOpen(false);
      setAttachmentToDelete(null);
      fetchAttachments();
    } catch (err) {
      addToast({
        type: "error",
        title:
          err instanceof Error ? err.message : "Failed to delete attachment",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    attachments,
    isLoading,
    error,
    isSubmitting,
    currentPage,
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
  };
}

export default useAttachments;
