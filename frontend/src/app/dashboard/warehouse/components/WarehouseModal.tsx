// src/app/dashboard/warehouse/components/WarehouseModal.tsx
import React from "react";
import {
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
    status: "active" | "suspended" | "inactive";
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      name: string;
      code: string;
      address: string;
      description: string;
      status: "active" | "suspended" | "inactive";
    }>
  >;
  onSubmit: (e: React.FormEvent) => void;
}

export const WarehouseModal: React.FC<WarehouseModalProps> = ({
  isOpen,
  onClose,
  modalType,
  hasWriteAccess,
  form,
  setForm,
  onSubmit,
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
            value={form.status}
            onChange={(val) =>
              setForm({
                ...form,
                status: val as "active" | "suspended" | "inactive",
              })
            }
            options={[
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
              { value: "inactive", label: "Inactive" },
            ]}
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
