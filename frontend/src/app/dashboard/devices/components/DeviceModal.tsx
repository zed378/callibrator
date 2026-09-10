// src/app/dashboard/devices/components/DeviceModal.tsx
import React from "react";
import {
  Dialog,
  Input,
  Select,
  Textarea,
  Button,
} from "@/components/ui";
import { Device, DeviceCreateInput } from "@/api/services/device.service";
import type { Warehouse } from "@/types";

interface DeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalType: "create" | "edit";
  isLoading: boolean;
  form: Omit<DeviceCreateInput, "id">;
  setForm: React.Dispatch<React.SetStateAction<Omit<DeviceCreateInput, "id">>>;
  warehousesData: Warehouse[];
  onSubmit: (e: React.FormEvent) => void;
}

export const DeviceModal: React.FC<DeviceModalProps> = ({
  isOpen,
  onClose,
  modalType,
  isLoading,
  form,
  setForm,
  warehousesData,
  onSubmit,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={modalType === "create" ? "Add Calibration Device" : "Edit Calibration Device"}
    >
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Device Name *
            </label>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Fluke Thermocouple Calibrator"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Serial Number
            </label>
            <Input
              value={form.serialNumber}
              onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
              placeholder="e.g. SN-883921"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Manufacturer
            </label>
            <Input
              value={form.manufacturer}
              onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
              placeholder="e.g. Fluke"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Model
            </label>
            <Input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="e.g. 714B"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Category
            </label>
            <Input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="e.g. Temperature"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Warehouse Assignment
            </label>
            <Select
              value={form.locationId || ""}
              onChange={(value) => setForm({ ...form, locationId: value })}
              options={[
                { value: "", label: "Unassigned" },
                ...(warehousesData.map((wh) => ({
                  value: wh.id,
                  label: `${wh.name} (${wh.code})`,
                })) || []),
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Status
            </label>
            <Select
              value={form.status || "active"}
              onChange={(value) => setForm({ ...form, status: value as Device["status"] })}
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
                { value: "maintenance", label: "Maintenance" },
                { value: "retired", label: "Retired" },
              ]}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Installation Date
            </label>
            <Input
              type="date"
              value={form.installationDate}
              onChange={(e) => setForm({ ...form, installationDate: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Next Calibration Date
            </label>
            <Input
              type="date"
              value={form.nextCalibrationDate}
              onChange={(e) => setForm({ ...form, nextCalibrationDate: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Interval Days
            </label>
            <Input
              type="number"
              min={1}
              value={form.calibrationIntervalDays}
              onChange={(e) => setForm({ ...form, calibrationIntervalDays: Number(e.target.value) })}
              placeholder="e.g. 180"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Remarks
          </label>
          <Textarea
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            placeholder="Calibration details or compliance notes..."
            rows={3}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {modalType === "create" ? "Create Device" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default DeviceModal;
