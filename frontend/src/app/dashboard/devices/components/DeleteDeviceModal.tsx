// src/app/dashboard/devices/components/DeleteDeviceModal.tsx
import React from "react";
import { Dialog, Button } from "@/components/ui";
import { Shield } from "lucide-react";

interface DeleteDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
}

export const DeleteDeviceModal: React.FC<DeleteDeviceModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Device"
    >
      <div className="space-y-4 pt-2">
        <div className="flex gap-3 text-warning">
          <Shield className="h-6 w-6 shrink-0" />
          <div>
            <p className="font-semibold text-foreground">Are you absolutely sure?</p>
            <p className="text-sm text-muted-foreground mt-1">
              This will soft-delete the calibration device. It can only be restored via database admin tools.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={isLoading}>
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default DeleteDeviceModal;
