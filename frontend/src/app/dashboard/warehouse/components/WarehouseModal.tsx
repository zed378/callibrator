// src/app/dashboard/warehouse/components/WarehouseModal.tsx
import React from "react";
import type { WarehouseStatus } from "@/types";
import {
  Alert,
  Dialog,
  FormField,
  Input,
  Textarea,
  Select,
  Button,
} from "@/components/ui";

interface WarehouseModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalType: "create" | "edit";
  hasWriteAccess: boolean;
  form: {
    name: string;
    code: string;
    address: string;
    description: string;
    status: WarehouseStatus | null;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      name: string;
      code: string;
      address: string;
      description: string;
      status: WarehouseStatus | null;
    }>
  >;
  onSubmit: (e: React.FormEvent) => void;
  /** F-19: a refused save, shown inside the dialog (a page alert sits behind it). */
  error?: string | null;
}

// A-355: only the statuses the API accepts (WAREHOUSE_STATUSES, warehouse
// model and validator agree). "Suspended" was offered and every save with it
// was refused with a 400. Typed by WarehouseStatus, so a value the contract
// does not publish fails the typecheck.
const STATUS_OPTIONS: { value: WarehouseStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export const WarehouseModal: React.FC<WarehouseModalProps> = ({
  isOpen,
  onClose,
  modalType,
  hasWriteAccess,
  form,
  setForm,
  onSubmit,
  error = null,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        modalType === "create"
          ? "Add New Warehouse"
          : hasWriteAccess
          ? "Edit Warehouse"
          : "Warehouse Details"
      }
      size="lg"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div role="alert">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Warehouse Name" required>
            <Input
              disabled={!hasWriteAccess}
              type="text"
              placeholder="e.g. Central Pharmacy Gudang"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Code / Identifier" required>
            <Input
              disabled={!hasWriteAccess}
              type="text"
              placeholder="e.g. WH-PHARM-01"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
            />
          </FormField>
        </div>
        <FormField label="Depot Address">
          <Input
            disabled={!hasWriteAccess}
            type="text"
            placeholder="e.g. Block B, Fl 2, Hospital Annex"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </FormField>
        <FormField label="Description">
          <Textarea
            disabled={!hasWriteAccess}
            placeholder="Describe use cases, contents, or access rules..."
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FormField>
        <FormField label="Operational Status">
          <Select
            disabled={!hasWriteAccess}
            value={form.status ?? ""}
            placeholder="Not set"
            onChange={(val) =>
              setForm({
                ...form,
                status:
                  STATUS_OPTIONS.find((o) => o.value === val)?.value ?? null,
              })
            }
            options={STATUS_OPTIONS}
          />
        </FormField>
        {hasWriteAccess && (
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              {modalType === "create" ? "Create Warehouse" : "Save Changes"}
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
};

export default WarehouseModal;
