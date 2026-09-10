// src/app/dashboard/stock/components/TransferModal.tsx
import React from "react";
import {
  Dialog,
  FormField,
  Input,
  Select,
  Textarea,
  Button,
} from "@/components/ui";

interface Option {
  value: string;
  label: string;
}

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: {
    fromWarehouseId: string;
    toWarehouseId: string;
    itemName: string;
    quantity: number;
    notes: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      fromWarehouseId: string;
      toWarehouseId: string;
      itemName: string;
      quantity: number;
      notes: string;
    }>
  >;
  warehouseOptions: Option[];
  onSubmit: (e: React.FormEvent) => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  form,
  setForm,
  warehouseOptions,
  onSubmit,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Dispatch Inter-depot Transfer"
      size="md"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField label="Item Name / Description" required>
          <Input
            type="text"
            placeholder="e.g. Infusion Pump Calibrator"
            value={form.itemName}
            onChange={(e) => setForm({ ...form, itemName: e.target.value })}
            required
          />
        </FormField>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Source Depot (From)" required>
            <Select
              value={form.fromWarehouseId}
              onChange={(val) => setForm({ ...form, fromWarehouseId: val })}
              options={warehouseOptions}
            />
          </FormField>
          <FormField label="Destination Depot (To)" required>
            <Select
              value={form.toWarehouseId}
              onChange={(val) => setForm({ ...form, toWarehouseId: val })}
              options={warehouseOptions}
            />
          </FormField>
        </div>
        <FormField label="Transfer Volume (Units)" required>
          <Input
            type="number"
            min="1"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })}
            required
          />
        </FormField>
        <FormField label="Shipping Notes">
          <Textarea
            placeholder="Specify carrier, tracking notes, or transfer reason..."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </FormField>
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Dispatch Transfer
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default TransferModal;
