import React from "react";
import { Dialog, Button } from "@/components/ui";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  type: string;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  type,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Delete ${type === "warehouse" ? "Warehouse" : "Sub-location"}`}
      size="sm"
    >
      <div className="space-y-4">
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
            className="bg-destructive hover:bg-destructive text-white border-destructive hover:border-destructive"
          >
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default DeleteConfirmModal;
