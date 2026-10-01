// src/app/dashboard/vendors/components/VendorModal.tsx
import React from "react";
import { Dialog, Input, Select, Textarea, Button } from "@/components/ui";
import { VendorStatus, VendorType } from "@/api/services/vendor.service";
import type { VendorFormState } from "../hooks/useVendors";
import { VENDOR_NOTES_MAX } from "@callibrator/contracts/vendor";

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
            <label htmlFor="vendors-components-vendormodal-f1" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Vendor Name *
            </label>
            <Input id="vendors-components-vendormodal-f1"
              required
              minLength={2}
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Precision Calibration Labs"
            />
          </div>

          <div>
            <label htmlFor="vendors-components-vendormodal-f2" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Type
            </label>
            <Select id="vendors-components-vendormodal-f2"
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
            <label htmlFor="vendors-components-vendormodal-f3" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Contact Person
            </label>
            <Input id="vendors-components-vendormodal-f3"
              value={form.contactPerson}
              onChange={(e) =>
                setForm({ ...form, contactPerson: e.target.value })
              }
              placeholder="e.g. John Doe"
            />
          </div>

          <div>
            <label htmlFor="vendors-components-vendormodal-f4" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Email
            </label>
            <Input id="vendors-components-vendormodal-f4"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="e.g. contact@vendor.com"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="vendors-components-vendormodal-f5" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Phone
            </label>
            <Input id="vendors-components-vendormodal-f5"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="e.g. +62 812 3456 7890"
            />
          </div>

          <div>
            <label htmlFor="vendors-components-vendormodal-f6" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Status
            </label>
            <Select id="vendors-components-vendormodal-f6"
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

          {/* Q-37: a rating comes from evaluation (scorecards, edit), not
              registration — the create contract has no rating. */}
          {modalType === "edit" && (
            <div>
              <label htmlFor="vendors-components-vendormodal-f7" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Rating (1-5)
              </label>
              <Input id="vendors-components-vendormodal-f7"
                type="number"
                min={1}
                max={5}
                step={0.5}
                value={form.rating}
                onChange={(e) => setForm({ ...form, rating: e.target.value })}
                placeholder="e.g. 4.5"
              />
            </div>
          )}
        </div>

        <div>
          <label htmlFor="vendors-components-vendormodal-f8" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Address
          </label>
          <Textarea id="vendors-components-vendormodal-f8"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Street, city, postal code..."
            rows={3}
          />
        </div>

        {/* Q-52: stored since migration 0106; bounded by the contract. */}
        <div>
          <label htmlFor="vendors-components-vendormodal-f9" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Notes
          </label>
          <Textarea id="vendors-components-vendormodal-f9"
            value={form.notes}
            maxLength={VENDOR_NOTES_MAX}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Accreditation scope, contract terms, contacts..."
            rows={3}
            aria-describedby="vendors-components-vendormodal-f9-count"
          />
          <p id="vendors-components-vendormodal-f9-count" className="mt-1 text-xs text-muted-foreground text-right">
            {form.notes.length} / {VENDOR_NOTES_MAX}
          </p>
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
