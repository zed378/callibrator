// src/app/dashboard/maintenance/components/WorkOrderModal.tsx
import React from "react";
import { Dialog, Input, Select, Textarea, Button } from "@/components/ui";
import {
  WorkOrderPriority,
  WorkOrderStatus,
  WorkOrderType,
} from "@/api/services/maintenance.service";
import { Device } from "@/api/services/device.service";
import { Vendor } from "@/api/services/vendor.service";
import type { WorkOrderFormState } from "../hooks/useMaintenance";

interface WorkOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalType: "create" | "edit";
  isLoading: boolean;
  form: WorkOrderFormState;
  setForm: React.Dispatch<React.SetStateAction<WorkOrderFormState>>;
  devices: Device[];
  vendors: Vendor[];
  onSubmit: (e: React.FormEvent) => void;
}

export const WorkOrderModal: React.FC<WorkOrderModalProps> = ({
  isOpen,
  onClose,
  modalType,
  isLoading,
  form,
  setForm,
  devices,
  vendors,
  onSubmit,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={modalType === "create" ? "New Work Order" : "Edit Work Order"}
    >
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Device *
          </label>
          <Select
            value={form.deviceId}
            onChange={(value) => setForm({ ...form, deviceId: value })}
            placeholder="Select a device..."
            options={devices.map((device) => ({
              value: device.id,
              label: device.serialNumber
                ? `${device.name} (${device.serialNumber})`
                : device.name,
            }))}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Title *
          </label>
          <Input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Quarterly preventative maintenance"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Description
          </label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe the maintenance work required..."
            rows={3}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Type
            </label>
            <Select
              value={form.type}
              onChange={(value) =>
                setForm({ ...form, type: value as WorkOrderType })
              }
              options={[
                { value: "Preventative", label: "Preventative" },
                { value: "Breakdown", label: "Breakdown" },
                { value: "Repair", label: "Repair" },
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Priority
            </label>
            <Select
              value={form.priority}
              onChange={(value) =>
                setForm({ ...form, priority: value as WorkOrderPriority })
              }
              options={[
                { value: "Low", label: "Low" },
                { value: "Medium", label: "Medium" },
                { value: "High", label: "High" },
                { value: "Critical", label: "Critical" },
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Status
            </label>
            <Select
              value={form.status}
              onChange={(value) =>
                setForm({ ...form, status: value as WorkOrderStatus })
              }
              options={[
                { value: "Open", label: "Open" },
                { value: "InProgress", label: "In Progress" },
                { value: "Completed", label: "Completed" },
                { value: "Cancelled", label: "Cancelled" },
              ]}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Vendor
          </label>
          <Select
            value={form.vendorId}
            onChange={(value) => setForm({ ...form, vendorId: value })}
            options={[
              { value: "", label: "None" },
              ...vendors.map((vendor) => ({
                value: vendor.id,
                label: vendor.name,
              })),
            ]}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {modalType === "create" ? "Create Work Order" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default WorkOrderModal;
