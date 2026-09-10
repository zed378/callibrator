// src/app/dashboard/tenants/components/CreateTenantModal.tsx
"use client";

import React from "react";
import { Button } from "@/components/ui";
import { Input, Textarea, Alert } from "@/components/ui";
import { X } from "lucide-react";
import LogoPreview from "./LogoPreview";
import TenantAddressFields from "./TenantAddressFields";

interface CreateTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: {
    name: string;
    code: string;
    description: string;
    primaryColor: string;
    maxUsers: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    website: string;
  };
  onChange: React.Dispatch<
    React.SetStateAction<{
      name: string;
      code: string;
      description: string;
      primaryColor: string;
      maxUsers: string;
      email: string;
      phone: string;
      address: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
      website: string;
    }>
  >;
  error: string;
  isSubmitting: boolean;
  logoFile: File | null;
  setLogoFile: React.Dispatch<React.SetStateAction<File | null>>;
  logoPreview: string;
  setLogoPreview: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: (e: React.FormEvent) => void;
}

export const CreateTenantModal: React.FC<CreateTenantModalProps> = ({
  isOpen,
  onClose,
  form,
  onChange,
  error,
  isSubmitting,
  logoFile,
  setLogoFile,
  logoPreview,
  setLogoPreview,
  onSubmit,
}) => {
  if (!isOpen) return null;

  const update = (field: string, value: string) =>
    onChange((f) => ({ ...f, [field]: value }));

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setLogoFile(file);
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
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-card rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold text-foreground">
            Create New Tenant
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
                required
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
              <LogoPreview
                preview={logoPreview}
                onClear={clearLogo}
                onFileChange={handleLogoChange}
              />
              <div className="space-y-4">
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
              Create Tenant
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTenantModal;
