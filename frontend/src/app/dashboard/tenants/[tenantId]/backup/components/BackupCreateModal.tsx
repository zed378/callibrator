import React from "react";
import { Card, Button } from "@/components/ui";
import { XCircle } from "lucide-react";

interface BackupCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  isCreating: boolean;
}

export const BackupCreateModal: React.FC<BackupCreateModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  form,
  setForm,
  isCreating,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold text-foreground">
            Create New Backup
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Backup Name *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                placeholder="e.g., Pre-migration backup"
                className="w-full px-3 py-2 border border-border rounded-lg bg-white text-foreground focus:ring-2 focus:ring-info focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({
                    ...form,
                    description: e.target.value,
                  })
                }
                placeholder="Optional description"
                rows={3}
                className="w-full px-3 py-2 border border-border rounded-lg bg-white text-foreground focus:ring-2 focus:ring-info focus:border-transparent"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Backup Type
                </label>
                <select
                  value={form.backupType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      backupType: e.target.value as
                        | "FULL"
                        | "PARTIAL"
                        | "USER_ONLY",
                    })
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg bg-white text-foreground focus:ring-2 focus:ring-info focus:border-transparent"
                >
                  <option value="FULL">Full</option>
                  <option value="PARTIAL">Partial</option>
                  <option value="USER_ONLY">Users Only</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Retention (days)
                </label>
                <input
                  type="number"
                  value={form.retentionDays}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      retentionDays: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg bg-white text-foreground focus:ring-2 focus:ring-info focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Tag
              </label>
              <input
                type="text"
                value={form.tag}
                onChange={(e) =>
                  setForm({ ...form, tag: e.target.value })
                }
                placeholder="e.g., pre-migration"
                className="w-full px-3 py-2 border border-border rounded-lg bg-white text-foreground focus:ring-2 focus:ring-info focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 p-6 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isCreating}>
              Create Backup
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default BackupCreateModal;
