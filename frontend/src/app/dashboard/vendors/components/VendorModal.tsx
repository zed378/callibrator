// src/app/dashboard/vendors/components/VendorModal.tsx
import React from "react";
import { Dialog, Input, Select, Textarea, Button } from "@/components/ui";
import { VendorStatus, VendorType } from "@/api/services/vendor.service";
import type { VendorFormState } from "../hooks/useVendors";

interface VendorModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalType: "create" | "edit";
  isLoading: boolean;
  form: VendorFormState;
  setForm: React.Dispatch<React.SetStateAction<VendorFormState>>;
  onSubmit: (e: React.FormEvent) => void;
}

export const VendorModal: React.FC<VendorModalProps> = ({
  isOpen,
  onClose,
  modalType,
  isLoading,
  form,
  setForm,
  onSubmit,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={modalType === "create" ? "Add Vendor" : "Edit Vendor"}
    >
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Vendor Name *
            </label>
            <Input
              required
              minLength={2}
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Precision Calibration Labs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Type
            </label>
            <Select
              value={form.type}
              onChange={(value) =>
                setForm({ ...form, type: value as VendorType })
              }
              options={[
                { value: "CalibrationLab", label: "Calibration Lab" },
                { value: "PartsSupplier", label: "Parts Supplier" },
                { value: "Other", label: "Other" },
              ]}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Contact Person
            </label>
            <Input
              value={form.contactPerson}
              onChange={(e) =>
                setForm({ ...form, contactPerson: e.target.value })
              }
              placeholder="e.g. John Doe"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Email
            </label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="e.g. contact@vendor.com"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Phone
            </label>
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="e.g. +62 812 3456 7890"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Status
            </label>
            <Select
              value={form.status}
              onChange={(value) =>
                setForm({ ...form, status: value as VendorStatus })
              }
              options={[
                { value: "Active", label: "Active" },
                { value: "Inactive", label: "Inactive" },
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Rating (1-5)
            </label>
            <Input
              type="number"
              min={1}
              max={5}
              step={0.5}
              value={form.rating}
              onChange={(e) => setForm({ ...form, rating: e.target.value })}
              placeholder="e.g. 4.5"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Address
          </label>
          <Textarea
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Street, city, postal code..."
            rows={3}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {modalType === "create" ? "Create Vendor" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default VendorModal;
