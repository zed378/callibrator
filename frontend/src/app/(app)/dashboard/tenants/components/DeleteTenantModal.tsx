import React, { useId } from "react";
import { Button } from "@/components/ui";
import { useModalA11y } from "@/components/ui/useModalA11y";

interface DeleteTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const DeleteTenantModal: React.FC<DeleteTenantModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  // F-12: a modal dialog — named by its title, focus moved in and
  // trapped, Escape closes, focus returns to the opener (useModalA11y).
  const panelRef = useModalA11y(isOpen, onClose);
  const titleId = useId();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-scrim flex items-center justify-center p-4 z-50">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-card rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <h3 id={titleId} className="text-lg font-bold text-foreground mb-2">
          Confirm Delete
        </h3>
        <p className="text-muted-foreground mb-6">
          Are you sure you want to delete this tenant? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DeleteTenantModal;
