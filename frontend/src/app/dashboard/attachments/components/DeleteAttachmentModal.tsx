// src/app/dashboard/attachments/components/DeleteAttachmentModal.tsx
import React from "react";
import { Dialog, Button, Alert } from "@/components/ui";
import { Attachment } from "@/api/services/attachment.service";

interface DeleteAttachmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  attachment: Attachment | null;
}

export const DeleteAttachmentModal: React.FC<DeleteAttachmentModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  attachment,
}) => {
  if (!attachment) return null;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Delete Attachment" size="sm">
      <div className="space-y-4 pt-2">
        <Alert variant="warning">
          Delete <strong>{attachment.originalName}</strong>? It will be removed
          from listings and its storage will be freed. This cannot be undone.
        </Alert>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={onConfirm}
            disabled={isLoading}
          >
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default DeleteAttachmentModal;
