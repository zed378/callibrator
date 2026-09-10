// src/app/dashboard/api-keys/components/RevokeApiKeyModal.tsx
import React from "react";
import { Dialog, Button } from "@/components/ui";
import { ShieldAlert } from "lucide-react";
import { ApiKey } from "@/api/services/apiKey.service";

interface RevokeApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  apiKey: ApiKey | null;
}

export const RevokeApiKeyModal: React.FC<RevokeApiKeyModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  apiKey,
}) => {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Revoke API Key">
      <div className="space-y-4 pt-2">
        <div className="flex gap-3 text-warning">
          <ShieldAlert className="h-6 w-6 shrink-0" />
          <div>
            <p className="font-semibold text-foreground">
              Revoke {apiKey ? `"${apiKey.name}"` : "this API key"}?
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Any integration using this key will immediately lose access.
              This action cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={isLoading}>
            Revoke Key
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default RevokeApiKeyModal;
