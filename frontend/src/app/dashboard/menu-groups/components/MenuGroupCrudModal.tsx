// src/app/dashboard/menu-groups/components/MenuGroupCrudModal.tsx
"use client";

import React from "react";
import { Dialog, Input, Button } from "@/components/ui";
import type { MenuGroupCrudForm } from "../hooks/useMenuGroupCrud";

interface MenuGroupCrudModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalType: "create" | "edit";
  isLoading: boolean;
  form: MenuGroupCrudForm;
  setForm: React.Dispatch<React.SetStateAction<MenuGroupCrudForm>>;
  onSubmit: (e: React.FormEvent) => void;
}

export const MenuGroupCrudModal: React.FC<MenuGroupCrudModalProps> = ({
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
      title={modalType === "create" ? "New Menu Group" : "Edit Menu Group"}
    >
      <form onSubmit={onSubmit} className="space-y-4 pt-2">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Name *
          </label>
          <Input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Inventory Management"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Slug
            </label>
            <Input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="e.g. inventory-management"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Icon
            </label>
            <Input
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              placeholder="e.g. LayoutGrid"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Sort Order
            </label>
            <Input
              type="number"
              value={form.sortOrder}
              onChange={(e) =>
                setForm({ ...form, sortOrder: Number(e.target.value) })
              }
              placeholder="e.g. 1"
            />
          </div>

          <div className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              id="menu-group-active"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="rounded border-border text-primary focus:ring-ring"
            />
            <label
              htmlFor="menu-group-active"
              className="text-sm font-semibold text-foreground"
            >
              Active
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {modalType === "create" ? "Create Menu Group" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default MenuGroupCrudModal;
