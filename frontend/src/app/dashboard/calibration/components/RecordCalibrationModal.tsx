import React from "react";
import { Dialog, Select, Input, Textarea, Button } from "@/components/ui";

interface RecordCalibrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  devices: any;
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  isLoading: boolean;
}

export const RecordCalibrationModal: React.FC<RecordCalibrationModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  devices,
  form,
  setForm,
  isLoading,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Record Calibration Audit Log"
    >
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Calibration Device *
          </label>
          <Select
            value={form.deviceId}
            onChange={(val) => setForm({ ...form, deviceId: val })}
            options={[
              { value: "", label: "Select Equipment" },
              ...(devices?.data.map((d: any) => ({
                value: d.id,
                label: `${d.name} (SN: ${d.serialNumber || "None"})`,
              })) || []),
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Calibration Date
            </label>
            <Input
              required
              type="date"
              value={form.calibrationDate}
              onChange={(e) => setForm({ ...form, calibrationDate: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Testing Standard
            </label>
            <Input
              value={form.standard}
              onChange={(e) => setForm({ ...form, standard: e.target.value })}
              placeholder="e.g. ISO 17025 Reference"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-b border-border py-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Test Temp Reading (°C)
            </label>
            <Input
              type="number"
              step="0.01"
              value={form.results.temperatureReading}
              onChange={(e) =>
                setForm({
                  ...form,
                  results: { ...form.results, temperatureReading: e.target.value },
                })
              }
              placeholder="e.g. 21.4"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Ref Humidity (%)
            </label>
            <Input
              type="number"
              step="0.01"
              value={form.results.humidityReading}
              onChange={(e) =>
                setForm({
                  ...form,
                  results: { ...form.results, humidityReading: e.target.value },
                })
              }
              placeholder="e.g. 45"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Deviation Variance *
            </label>
            <Input
              required
              type="number"
              step="0.01"
              value={form.results.deviation}
              onChange={(e) =>
                setForm({
                  ...form,
                  results: { ...form.results, deviation: e.target.value },
                })
              }
              placeholder="e.g. 0.02"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Overall Compliance Status:
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-muted-foreground cursor-pointer">
              <input
                type="radio"
                name="isCompliant"
                checked={form.isCompliant === true}
                onChange={() => setForm({ ...form, isCompliant: true })}
                className="accent-indigo-500 cursor-pointer"
              />
              Compliant / Pass
            </label>
            <label className="flex items-center gap-2 text-muted-foreground cursor-pointer">
              <input
                type="radio"
                name="isCompliant"
                checked={form.isCompliant === false}
                onChange={() => setForm({ ...form, isCompliant: false })}
                className="accent-red-500 cursor-pointer"
              />
              Non-Compliant / Fail
            </label>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Audit Notes / Findings
          </label>
          <Textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Details of calibration, adjusted parameters, calibration standards checks..."
            rows={3}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            Log Record
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default RecordCalibrationModal;
