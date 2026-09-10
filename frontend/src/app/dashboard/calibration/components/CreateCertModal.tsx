import React from "react";
import { Dialog, Badge, Select, Input, Textarea, Button } from "@/components/ui";
import { Sparkles } from "lucide-react";
import { Calibration } from "@/api/services/calibration.service";

interface CreateCertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  selectedRecordForCert: Calibration | null;
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  isLoading: boolean;
}

export const CreateCertModal: React.FC<CreateCertModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  selectedRecordForCert,
  form,
  setForm,
  isLoading,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Certify Validation Check"
    >
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div className="bg-card p-3 rounded-lg border border-border flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Link Record ID</p>
            <p className="font-mono text-xs text-foreground mt-0.5">{selectedRecordForCert?.id}</p>
          </div>
          <Badge variant="secondary" className="border-primary text-primary flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            Validated
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Certificate Type
            </label>
            <Select
              value={form.type}
              onChange={(val) => setForm({ ...form, type: val })}
              options={[
                { value: "calibration", label: "Calibration Certificate" },
                { value: "maintenance", label: "Maintenance Certificate" },
                { value: "verification", label: "Verification Certificate" },
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Valid Until Date *
            </label>
            <Input
              required
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Summary / Statement of Compliance
          </label>
          <Textarea
            required
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            placeholder="Certificate summary..."
            rows={3}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Environmental / Operating Conditions
          </label>
          <Input
            value={form.conditions}
            onChange={(e) => setForm({ ...form, conditions: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Additional Notes
          </label>
          <Textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Traceability metrics or comments..."
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            Generate Draft
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default CreateCertModal;
