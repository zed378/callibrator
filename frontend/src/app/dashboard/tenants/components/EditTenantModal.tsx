// src/app/dashboard/tenants/components/EditTenantModal.tsx
"use client";

import React from "react";
import type { Tenant } from "@/types";
import { Button, Input, Select, Textarea, Alert } from "@/components/ui";
import { X } from "lucide-react";
import TenantAddressFields from "./TenantAddressFields";
import LogoPreview from "./LogoPreview";

export interface TenantFormState {
  name: string;
  code: string;
  description: string;
  primaryColor: string;
  status: string;
  maxUsers: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  website: string;
}

interface EditTenantModalProps {
  isOpen: boolean;
  tenant: Tenant | null;
  onClose: () => void;
  form: TenantFormState;
  onChange: React.Dispatch<React.SetStateAction<TenantFormState>>;
  error: string;
  isSubmitting: boolean;
  logoFile: File | null;
  setLogoFile: React.Dispatch<React.SetStateAction<File | null>>;
  logoPreview: string;
  setLogoPreview: React.Dispatch<React.SetStateAction<string>>;
  logoKeep: boolean;
  setLogoKeep: React.Dispatch<React.SetStateAction<boolean>>;
  onSubmit: (e: React.FormEvent) => void;
}

const statusOptions = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "SUSPENDED", label: "Suspended" },
];

export const EditTenantModal: React.FC<EditTenantModalProps> = ({
  isOpen,
  tenant,
  onClose,
  form,
  onChange,
  error,
  isSubmitting,
  logoFile,
  setLogoFile,
  logoPreview,
  setLogoPreview,
  logoKeep,
  setLogoKeep,
  onSubmit,
}) => {
  if (!isOpen || !tenant) return null;

  const update = (field: string, value: string) =>
    onChange((f) => ({ ...f, [field]: value }));

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setLogoFile(file);
    setLogoKeep(false);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview("");
    setLogoKeep(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-card rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold text-foreground">
            Edit Tenant
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="p-6 space-y-4">
            {error && (
              <Alert variant="error" title={error}>
                {error}
              </Alert>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Hospital Name"
                required
              />
              <Input
                label="Code"
                value={form.code}
                onChange={(e) => update("code", e.target.value)}
                placeholder="HOSP001"
                disabled
              />
            </div>
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Hospital description"
              rows={3}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <LogoPreview
                  preview={logoPreview}
                  onClear={clearLogo}
                  onFileChange={handleLogoChange}
                  isEdit
                  keepOld={logoKeep}
                  existingLogo={tenant.logoBaseUrl || tenant.logo || undefined}
                />
                {logoPreview && !logoFile && (
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={logoKeep}
                      onChange={(e) => setLogoKeep(e.target.checked)}
                      className="w-4 h-4 text-primary ring-1 ring-border rounded focus:ring-ring"
                    />
                    <span className="text-sm text-foreground">
                      Keep current logo
                    </span>
                  </label>
                )}
              </div>
              <div className="space-y-4">
                <Select
                  value={form.status}
                  onChange={(val) => update("status", val)}
                  options={statusOptions}
                  placeholder="Select status"
                  className="w-full"
                />
                <Input
                  label="Max Users"
                  type="number"
                  value={form.maxUsers}
                  onChange={(e) => update("maxUsers", e.target.value)}
                  placeholder="100"
                />
                <Input
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="tenant@example.com"
                />
              </div>
            </div>
            
            <TenantAddressFields
              form={form}
              update={(field, val) => update(field as string, val)}
            />
          </div>
          <div className="flex justify-end gap-3 p-6 border-t border-border">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Update Tenant
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditTenantModal;
