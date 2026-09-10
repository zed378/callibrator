// src/app/dashboard/stock/components/StockModal.tsx
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

interface StockModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalType: "create" | "edit";
  hasWriteAccess: boolean;
  form: {
    warehouseId: string;
    locationId: string;
    itemName: string;
    sku: string;
    serialNumber: string;
    quantity: number;
    minQuantity: number;
    description: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      warehouseId: string;
      locationId: string;
      itemName: string;
      sku: string;
      serialNumber: string;
      quantity: number;
      minQuantity: number;
      description: string;
    }>
  >;
  warehouseOptions: Option[];
  locationOptions: Option[];
  onWarehouseChange: (warehouseId: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const StockModal: React.FC<StockModalProps> = ({
  isOpen,
  onClose,
  modalType,
  hasWriteAccess,
  form,
  setForm,
  warehouseOptions,
  locationOptions,
  onWarehouseChange,
  onSubmit,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        modalType === "create"
          ? "Add Inventory Item"
          : hasWriteAccess
          ? "Edit Inventory Details"
          : "Inventory Details"
      }
      size="lg"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField label="Item Name / Description" required>
          <Input
            disabled={modalType === "edit" || !hasWriteAccess}
            type="text"
            placeholder="e.g. Infusion Pump Calibrator Tool"
            value={form.itemName}
            onChange={(e) => setForm({ ...form, itemName: e.target.value })}
            required
          />
        </FormField>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="SKU / Reference ID">
            <Input
              disabled={!hasWriteAccess}
              type="text"
              placeholder="e.g. SKU-INF-001"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </FormField>
          <FormField label="Serial Number">
            <Input
              disabled={!hasWriteAccess}
              type="text"
              placeholder="e.g. SN-98218-A"
              value={form.serialNumber}
              onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Warehouse Depot" required>
            <Select
              disabled={modalType === "edit" || !hasWriteAccess}
              value={form.warehouseId}
              onChange={onWarehouseChange}
              options={warehouseOptions}
            />
          </FormField>
          <FormField label="Storage Shelf (Sub-location)">
            <Select
              disabled={modalType === "edit" || !hasWriteAccess}
              value={form.locationId}
              onChange={(val) => setForm({ ...form, locationId: val })}
              options={[{ value: "", label: "No Specific Shelf" }, ...locationOptions]}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Starting Quantity" required>
            <Input
              disabled={modalType === "edit" || !hasWriteAccess}
              type="number"
              min="0"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 0 })}
              required
            />
          </FormField>
          <FormField label="Min safety Threshold" required>
            <Input
              disabled={!hasWriteAccess}
              type="number"
              min="0"
              value={form.minQuantity}
              onChange={(e) => setForm({ ...form, minQuantity: parseInt(e.target.value) || 0 })}
              required
            />
          </FormField>
        </div>
        <FormField label="Additional Description">
          <Textarea
            disabled={!hasWriteAccess}
            placeholder="Details about calibrator manuals, calibration due warnings, etc."
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FormField>
        {hasWriteAccess && (
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              {modalType === "create" ? "Add Stock" : "Save Changes"}
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
};

export default StockModal;
