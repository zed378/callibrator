// src/app/dashboard/tenants/components/EditTenantModal.tsx
"use client";

import React, { useId, useState } from "react";
import type { Tenant } from "@/types";
import { Button, Input, Textarea, Alert } from "@/components/ui";
import { X } from "lucide-react";
import TenantAddressFields from "./TenantAddressFields";
import LogoPreview from "./LogoPreview";
import { useModalA11y } from "@/components/ui/useModalA11y";

export interface TenantFormState {
  name: string;
  code: string;
  description: string;
  primaryColor: string;
  status: string;
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
  /**
   * Whether the caller is the platform operator (super admin). Only then are
   * the lifecycle actions offered (A-63: nobody else may change a tenant's
   * status). A-303: the seat limit is not an edit field at all.
   */
  platformFieldsEditable?: boolean;
  /**
   * A-326 / ADR-112: the status is never edited; it moves only through the
   * tenant lifecycle (POST /tenants/:id/suspend and /resume), which records
   * the reason, the actor and the audit rows. The modal shows the status
   * read-only and, to the super admin, offers these two actions.
   */
  onLifecycle?: (action: "suspend" | "resume", reason?: string) => void | Promise<void>;
}

/** The tenant's status as a label: the API answers the lower-case ENUM. */
const statusLabel = (status: string): string =>
  status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : "Unknown";

export const EditTenantModal: React.FC<EditTenantModalProps> = ({
  isOpen,
  tenant,
  onClose,
  form,
  onChange,
  error,
  isSubmitting,
  platformFieldsEditable = true,
  logoFile,
  setLogoFile,
  logoPreview,
  setLogoPreview,
  logoKeep,
  setLogoKeep,
  onSubmit,
  onLifecycle,
}) => {
  // F-12: a modal dialog — named by its title, focus moved in and
  // trapped, Escape closes, focus returns to the opener (useModalA11y).
  const panelRef = useModalA11y(Boolean(isOpen && tenant), onClose);
  const titleId = useId();
  const statusId = useId();
  const reasonId = useId();
  const [suspendReason, setSuspendReason] = useState("");
  if (!isOpen || !tenant) return null;

  const isSuspended = (tenant.status || "").toLowerCase() === "suspended";
  const canChangeStatus = platformFieldsEditable && onLifecycle !== undefined;

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
    <div className="fixed inset-0 bg-scrim flex items-center justify-center z-50 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-card rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 id={titleId} className="text-xl font-bold text-foreground">
            Edit Tenant
          </h2>
          <Button aria-label="Close" variant="ghost" size="sm" onClick={onClose}>
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
                <div className="space-y-2">
                  <span id={statusId} className="block text-sm font-medium text-foreground">
                    Status
                  </span>
                  <p aria-labelledby={statusId} className="text-sm text-foreground" data-testid="tenant-status">
                    {statusLabel(tenant.status)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The status is not edited here. It changes through the tenant
                    lifecycle: suspend (with a reason) or resume.
                  </p>
                  {canChangeStatus &&
                    (isSuspended ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isSubmitting}
                        onClick={() => void onLifecycle("resume")}>
                        Resume tenant
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <label htmlFor={reasonId} className="block text-sm text-foreground">
                          Reason for suspension
                        </label>
                        <Input
                          id={reasonId}
                          value={suspendReason}
                          onChange={(e) => setSuspendReason(e.target.value)}
                          placeholder="e.g. Contract ended"
                        />
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={isSubmitting || suspendReason.trim() === ""}
                          onClick={() => void onLifecycle("suspend", suspendReason.trim())}>
                          Suspend tenant
                        </Button>
                      </div>
                    ))}
                </div>
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
