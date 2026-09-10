// src/app/dashboard/webhooks/components/DeleteWebhookModal.tsx
import React from "react";
import { Dialog, Button } from "@/components/ui";
import { ShieldAlert } from "lucide-react";
import { Webhook } from "@/api/services/webhook.service";

interface DeleteWebhookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  webhook: Webhook | null;
}

export const DeleteWebhookModal: React.FC<DeleteWebhookModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  webhook,
}) => {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Delete Webhook">
      <div className="space-y-4 pt-2">
        <div className="flex gap-3 text-warning">
          <ShieldAlert className="h-6 w-6 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">
              Delete this webhook?
            </p>
            {webhook && (
              <code className="font-mono text-xs text-muted-foreground block max-w-full truncate mt-1">
                {webhook.url}
              </code>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              No further events will be delivered to this endpoint and its
              delivery history will no longer be accessible. This action
              cannot be undone.
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

export default DeleteWebhookModal;
