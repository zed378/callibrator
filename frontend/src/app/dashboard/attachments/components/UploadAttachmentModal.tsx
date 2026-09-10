// src/app/dashboard/attachments/components/UploadAttachmentModal.tsx
import React from "react";
import { Dialog, Input, Select, Button } from "@/components/ui";
import { UploadCloud, FileText } from "lucide-react";
import type { AttachmentFormState } from "../hooks/useAttachments";

interface UploadAttachmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  form: AttachmentFormState;
  setForm: React.Dispatch<React.SetStateAction<AttachmentFormState>>;
  file: File | null;
  setFile: (file: File | null) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const RESOURCE_TYPE_OPTIONS = [
  { value: "generic", label: "General / Unlinked" },
  { value: "device", label: "Device" },
  { value: "certificate", label: "Certificate" },
  { value: "workorder", label: "Work Order" },
  { value: "calibration", label: "Calibration Record" },
];

// Documents + images (must match the backend allowlist).
const ACCEPT =
  ".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";

export const UploadAttachmentModal: React.FC<UploadAttachmentModalProps> = ({
  isOpen,
  onClose,
  isLoading,
  form,
  setForm,
  file,
  setFile,
  onSubmit,
}) => {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Upload File">
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            File *
          </label>
          <label
            htmlFor="attachment-file"
            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg px-4 py-8 cursor-pointer hover:bg-muted/50 transition-colors"
          >
            {file ? (
              <>
                <FileText className="h-8 w-8 text-primary" />
                <span className="text-sm font-medium text-foreground break-all text-center">
                  {file.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB — click to change
                </span>
              </>
            ) : (
              <>
                <UploadCloud className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Click to choose a file
                </span>
                <span className="text-xs text-muted-foreground">
                  Images, PDF, Office docs, CSV, TXT (max 25MB)
                </span>
              </>
            )}
          </label>
          <input
            id="attachment-file"
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Link To
          </label>
          <Select
            value={form.resourceType}
            onChange={(value) => setForm({ ...form, resourceType: value })}
            options={RESOURCE_TYPE_OPTIONS}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Linked Record ID
          </label>
          <Input
            value={form.resourceId}
            onChange={(e) => setForm({ ...form, resourceId: e.target.value })}
            placeholder="Optional — e.g. a device or certificate UUID"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Leave empty for a standalone file.
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading || !file}>
            Upload
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default UploadAttachmentModal;
