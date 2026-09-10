// src/app/dashboard/webhooks/components/WebhookModal.tsx
import React, { useState } from "react";
import { Dialog, Input, Button, Badge, Alert } from "@/components/ui";
import { Copy, Plus } from "lucide-react";
import type { WebhookFormState } from "../hooks/useWebhooks";

interface WebhookModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalType: "create" | "edit";
  isLoading: boolean;
  form: WebhookFormState;
  setForm: React.Dispatch<React.SetStateAction<WebhookFormState>>;
  toggleEvent: (event: string) => void;
  addEvent: (event: string) => void;
  removeEvent: (event: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  createdSecret: string | null;
  onCopySecret: () => void;
}

const PREDEFINED_EVENTS = [
  "*",
  "device.calibration_due",
  "device.overdue",
  "webhook.test",
];

export const WebhookModal: React.FC<WebhookModalProps> = ({
  isOpen,
  onClose,
  modalType,
  isLoading,
  form,
  setForm,
  toggleEvent,
  addEvent,
  removeEvent,
  onSubmit,
  createdSecret,
  onCopySecret,
}) => {
  const [customEvent, setCustomEvent] = useState("");

  const handleAddCustomEvent = () => {
    addEvent(customEvent);
    setCustomEvent("");
  };

  const customEvents = form.events.filter(
    (event) => !PREDEFINED_EVENTS.includes(event),
  );

  // ── Secret reveal state (after successful creation) ────────────────────────
  if (createdSecret) {
    return (
      <Dialog isOpen={isOpen} onClose={onClose} title="Webhook Created">
        <div className="space-y-4 pt-2">
          <Alert variant="warning" title="Store this secret securely">
            This signing secret is shown only once — it cannot be retrieved
            again. Store it securely before closing this dialog.
          </Alert>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Signing Secret
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 block font-mono text-sm bg-muted text-foreground rounded-lg px-3 py-2.5 break-all select-all border border-border">
                {createdSecret}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCopySecret}
                className="shrink-0 flex items-center gap-1.5"
              >
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Each delivery includes an{" "}
              <code className="font-mono">X-Webhook-Signature</code> header —
              an HMAC-SHA256 of the request body computed with this secret.
              Use it to verify payload authenticity.
            </p>
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

  // ── Create / Edit form state ───────────────────────────────────────────────
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={modalType === "create" ? "Add Webhook" : "Edit Webhook"}
    >
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Endpoint URL *
          </label>
          <Input
            required
            type="url"
            pattern="https?://.*"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://example.com/webhooks/calibrator"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Events *
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PREDEFINED_EVENTS.map((event) => (
              <label
                key={event}
                className="flex items-center gap-2 text-sm text-foreground cursor-pointer rounded-lg border border-border px-3 py-2 hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={form.events.includes(event)}
                  onChange={() => toggleEvent(event)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <code className="font-mono text-xs">
                  {event === "*" ? "* (all events)" : event}
                </code>
              </label>
            ))}
          </div>

          <div className="flex gap-2 mt-3">
            <Input
              value={customEvent}
              onChange={(e) => setCustomEvent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustomEvent();
                }
              }}
              placeholder="Custom event name, e.g. certificate.issued"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleAddCustomEvent}
              className="shrink-0 flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>

          {customEvents.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {customEvents.map((event) => (
                <Badge
                  key={event}
                  variant="primary"
                  size="sm"
                  removable
                  onRemove={() => removeEvent(event)}
                >
                  {event}
                </Badge>
              ))}
            </div>
          )}
          {form.events.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Select at least one event to subscribe to.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Description
          </label>
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="e.g. Notify CMMS when devices become overdue"
          />
        </div>

        {modalType === "edit" && (
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) =>
                setForm({ ...form, isActive: e.target.checked })
              }
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Active — deliver events to this endpoint
          </label>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {modalType === "create" ? "Create Webhook" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default WebhookModal;
