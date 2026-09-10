// src/app/dashboard/api-keys/components/CreateApiKeyModal.tsx
import React, { useState } from "react";
import { Dialog, Input, Select, Button, Badge, Alert } from "@/components/ui";
import { Copy, Plus } from "lucide-react";
import type { ApiKeyFormState } from "../hooks/useApiKeys";

interface CreateApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  form: ApiKeyFormState;
  setForm: React.Dispatch<React.SetStateAction<ApiKeyFormState>>;
  addScope: (scope: string) => void;
  removeScope: (scope: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  createdKey: string | null;
  onCopyKey: () => void;
}

const RESOURCE_OPTIONS = [
  { value: "*", label: "All resources (*)" },
  { value: "CalibrationDevices", label: "Calibration Devices" },
  { value: "CalibrationRecords", label: "Calibration Records" },
  { value: "Certificates", label: "Certificates" },
  { value: "Stocks", label: "Stocks" },
  { value: "Warehouses", label: "Warehouses" },
  { value: "Vendors", label: "Vendors" },
  { value: "Maintenance", label: "Maintenance" },
];

const ACTION_OPTIONS = [
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
  { value: "*", label: "All actions (*)" },
];

export const CreateApiKeyModal: React.FC<CreateApiKeyModalProps> = ({
  isOpen,
  onClose,
  isLoading,
  form,
  setForm,
  addScope,
  removeScope,
  onSubmit,
  createdKey,
  onCopyKey,
}) => {
  const [resource, setResource] = useState("CalibrationDevices");
  const [action, setAction] = useState("read");

  const handleAddScope = () => {
    // "*:*" collapses to the global wildcard "*".
    const scope =
      resource === "*" && action === "*" ? "*" : `${resource}:${action}`;
    addScope(scope);
  };

  // ── Key reveal state (after successful creation) ──────────────────────────
  if (createdKey) {
    return (
      <Dialog isOpen={isOpen} onClose={onClose} title="API Key Created">
        <div className="space-y-4 pt-2">
          <Alert variant="warning" title="Store this key securely">
            This key is shown only once — it cannot be retrieved again. Store
            it securely before closing this dialog.
          </Alert>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Your API Key
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 block font-mono text-sm bg-muted text-foreground rounded-lg px-3 py-2.5 break-all select-all border border-border">
                {createdKey}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCopyKey}
                className="shrink-0 flex items-center gap-1.5"
              >
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  // ── Create form state ──────────────────────────────────────────────────────
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Create API Key">
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Name *
          </label>
          <Input
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. CI Pipeline, Reporting Integration"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Scopes *
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
            <Select
              value={resource}
              onChange={(value) => setResource(value)}
              options={RESOURCE_OPTIONS}
            />
            <Select
              value={action}
              onChange={(value) => setAction(value)}
              options={ACTION_OPTIONS}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleAddScope}
              className="flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add scope
            </Button>
          </div>

          {form.scopes.length > 0 ? (
            <div className="flex flex-wrap gap-2 mt-3">
              {form.scopes.map((scope) => (
                <Badge
                  key={scope}
                  variant="primary"
                  size="sm"
                  removable
                  onRemove={() => removeScope(scope)}
                >
                  {scope}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">
              No scopes added yet. Add at least one scope, e.g.
              &quot;CalibrationDevices:read&quot;.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Expires At
          </label>
          <Input
            type="date"
            value={form.expiresAt}
            onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Leave empty for a key that never expires.
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            Create API Key
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default CreateApiKeyModal;
