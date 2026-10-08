import React from "react";
import { Alert, Dialog, Button } from "@/components/ui";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  type: string;
  /** F-19: a refused delete, shown in this dialog (a page alert sits behind it). */
  error?: string | null;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  type,
  error = null,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Delete ${type === "warehouse" ? "Warehouse" : "Sub-location"}`}
      size="sm"
    >
      <div className="space-y-4">
        {error && (
          <div role="alert">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        <p className="text-muted-foreground">
          Are you sure you want to permanently delete this {type}? All nested relationships and records will be affected. This action is irreversible.
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            className="bg-destructive hover:bg-destructive text-destructive-foreground border-destructive hover:border-destructive"
          >
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default DeleteConfirmModal;
