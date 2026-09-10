import React from "react";
import { Shield, X, AlertTriangle, Loader2 } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui";

interface RoleForm {
  name: string;
  description: string;
  nameToShow: string;
  isActive: boolean;
  roleLevel: number;
}

interface RolesModalProps {
  type: "create" | "edit";
  isOpen: boolean;
  onClose: () => void;
  form: RoleForm;
  formError: string;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onChange: (form: RoleForm) => void;
}

export const RolesModal: React.FC<RolesModalProps> = ({
  type,
  isOpen,
  onClose,
  form,
  formError,
  isSubmitting,
  onSubmit,
  onChange,
}) => {
  if (!isOpen) return null;

  const title = type === "create" ? "Create New Role" : "Edit Role";
  const submitLabel = type === "create" ? "Create Role" : "Update Role";

  const setField = <K extends keyof RoleForm>(key: K, value: RoleForm[K]) =>
    onChange({ ...form, [key]: value });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-card rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold text-foreground">
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="p-6 space-y-4">
            {formError && (
              <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <span className="text-sm text-destructive">
                  {formError}
                </span>
              </div>
            )}
            <Input
              label="Role Name"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="e.g., SUPER_ADMIN"
              leftIcon={<Shield className="h-4 w-4" />}
              required
            />
            <Input
              label="Display Name"
              value={form.nameToShow}
              onChange={(e) => setField("nameToShow", e.target.value)}
              placeholder="e.g., Super Admin"
              leftIcon={<Shield className="h-4 w-4" />}
            />
            <div className="border border-border rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-medium text-foreground">
                Advanced Settings
              </h4>
              <Textarea
                label="Description"
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
                placeholder="Role description..."
                className="resize-none"
                rows={3}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Role Level
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={form.roleLevel}
                    onChange={(e) =>
                      setField(
                        "roleLevel",
                        parseInt(e.target.value) || 1,
                      )
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    1 = Lowest, 10 = Highest
                  </p>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) =>
                        setField("isActive", e.target.checked)
                      }
                      className="w-4 h-4 text-primary ring-1 ring-border rounded focus:ring-ring"
                    />
                    <span className="text-sm text-foreground">
                      Active
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3 p-6 border-t border-border">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
