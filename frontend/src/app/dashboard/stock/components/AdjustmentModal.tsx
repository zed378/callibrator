// src/app/dashboard/stock/components/AdjustmentModal.tsx
import React from "react";
import {
  Dialog,
  FormField,
  Input,
  Select,
  Textarea,
  Button,
} from "@/components/ui";
import { Stock } from "@/types";

interface AdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedStock: Stock | null;
  form: {
    stockId: string;
    type: "addition" | "subtraction" | "write_off";
    quantity: number;
    reason: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      stockId: string;
      type: "addition" | "subtraction" | "write_off";
      quantity: number;
      reason: string;
    }>
  >;
  onSubmit: (e: React.FormEvent) => void;
}

export const AdjustmentModal: React.FC<AdjustmentModalProps> = ({
  isOpen,
  onClose,
  selectedStock,
  form,
  setForm,
  onSubmit,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Manual Stock Adjustment"
      size="md"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="p-3 bg-muted/40 rounded-xl">
          <div className="text-xs text-muted-foreground">Adjusting Inventory For:</div>
          <div className="font-bold text-foreground">{selectedStock?.itemName}</div>
          <div className="text-xs text-muted-foreground mt-1">Current Balance: {selectedStock?.quantity} units</div>
        </div>
        <FormField label="Adjustment Type" required>
          <Select
            value={form.type}
            onChange={(val) =>
              setForm({
                ...form,
                type: val as "addition" | "subtraction" | "write_off",
              })
            }
            options={[
              { value: "addition", label: "Addition (Receive stock)" },
              { value: "subtraction", label: "Subtraction (Dispatch / Use stock)" },
              { value: "write_off", label: "Write-off (Damaged / Missing stock)" },
            ]}
          />
        </FormField>
        <FormField label="Quantity Delta" required>
          <Input
            type="number"
            min="1"
            value={form.quantity}
            onChange={(e) =>
              setForm({ ...form, quantity: parseInt(e.target.value) || 1 })
            }
            required
          />
        </FormField>
        <FormField label="Reason for Adjustment" required>
          <Textarea
            placeholder="Provide details for this stock correction..."
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            required
          />
        </FormField>
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Submit Adjustment
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default AdjustmentModal;
