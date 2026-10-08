// src/app/dashboard/stock/components/OpnameModal.tsx
import React from "react";
import {
  Alert,
  Dialog,
  FormField,
  Select,
  Textarea,
  Button,
} from "@/components/ui";
import { DateField } from "@/components/ui/DateField";

interface Option {
  value: string;
  label: string;
}

interface OpnameModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: {
    warehouseId: string;
    scheduledAt: string;
    notes: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      warehouseId: string;
      scheduledAt: string;
      notes: string;
    }>
  >;
  warehouseOptions: Option[];
  onSubmit: (e: React.FormEvent) => void;
  /** F-19: a refused save, shown inside the dialog (a page alert sits behind it). */
  error?: string | null;
}

export const OpnameModal: React.FC<OpnameModalProps> = ({
  isOpen,
  onClose,
  form,
  setForm,
  warehouseOptions,
  onSubmit,
  error = null,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Schedule Physical Count Audit"
      size="md"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div role="alert">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        <FormField label="Depot to Audit" required>
          <Select
            value={form.warehouseId}
            onChange={(val) => setForm({ ...form, warehouseId: val })}
            options={warehouseOptions}
          />
        </FormField>
        <FormField label="Audit Schedule Date" required>
          <DateField
            value={form.scheduledAt}
            onChange={(val) => setForm({ ...form, scheduledAt: val })}
            required
          />
        </FormField>
        <FormField label="Audit Instructions / Notes">
          <Textarea
            placeholder="Provide checklist or special instructions for stock counters..."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </FormField>
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Schedule Count
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default OpnameModal;
