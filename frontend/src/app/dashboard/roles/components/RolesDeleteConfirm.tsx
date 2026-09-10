import React from "react";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui";

interface RolesDeleteConfirmProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
}

export const RolesDeleteConfirm: React.FC<RolesDeleteConfirmProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md bg-card rounded-2xl shadow-2xl">
        <div className="p-6">
          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-destructive/10 rounded-full">
            <XCircle className="w-6 h-6 text-destructive" />
          </div>
          <div className="mt-4 text-center">
            <h3 className="text-lg font-medium text-foreground">
              Delete Role
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to delete this role? This action cannot be
              undone.
            </p>
          </div>
          <div className="mt-6 flex gap-3">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={onConfirm}
              isLoading={isLoading}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
