"use client";

import React, { useState } from "react";
import type { Tenant } from "@/types";
import { Alert, Button, ConfirmDialog, Dialog } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { tenantService } from "@/api/services/tenant.service";
import { useTenantStore } from "@/stores/tenantStore";
import { useToastStore } from "@/stores/toastStore";
import { useI18n } from "@/i18n/MessagesProvider";

interface Props {
  tenant: Tenant;
  onClose: () => void;
}

/** Whether the tenant's flag opens invitations (fail-closed: only a JSON `true`, as the server reads it). */
export const invitationsOpenOf = (tenant: Tenant): boolean => tenant.settings?.["upstream_invitations_open"] === true;

/**
 * P24-09d (ADR-139 § 3, Am. 1) — the platform operator's switch for a tenant's imported users'
 * invitations (`upstream_invitations_open`, PATCH /admin/tenants/:id/flags, audited). Opening it is
 * the cutover act (P30-04) once the pre-invitation gate's evidence is recorded: the panel says so and
 * asks for confirmation. Closing stops new invitations; the ones already sent keep working until they
 * expire or are withdrawn.
 */
export function UpstreamInvitationsPanel({ tenant, onClose }: Props) {
  const { t } = useI18n();
  const addToast = useToastStore((s) => s.addToast);
  const refetchTenants = useTenantStore((s) => s.refetchTenants);
  const [open, setOpen] = useState(invitationsOpenOf(tenant));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const change = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const updated = await tenantService.setUpstreamInvitationsOpen(tenant.id, !open);
      const now = invitationsOpenOf(updated);
      setOpen(now);
      addToast({ type: "success", title: t(now ? "tenantInvitations.opened" : "tenantInvitations.closed", { name: tenant.name }) });
      void refetchTenants();
    } catch (err) {
      setFailure(describeApiError(err).message || t("tenantInvitations.failed"));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Dialog isOpen onClose={onClose} title={t("tenantInvitations.title", { name: tenant.name })} size="md">
      <div className="space-y-4 text-left">
        <p className="text-sm text-muted-foreground">{t("tenantInvitations.lead")}</p>
        <p className="text-sm font-semibold text-foreground" data-testid="invitations-state">
          {t(open ? "tenantInvitations.stateOpen" : "tenantInvitations.stateClosed")}
        </p>
        {failure && <Alert variant="error">{failure}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant={open ? "outline" : "primary"} isLoading={busy} onClick={() => setConfirming(true)}>
            {t(open ? "tenantInvitations.close" : "tenantInvitations.open")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("tenantInvitations.dismiss")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        isOpen={confirming}
        title={t(open ? "tenantInvitations.confirmCloseTitle" : "tenantInvitations.confirmOpenTitle", { name: tenant.name })}
        description={t(open ? "tenantInvitations.confirmClose" : "tenantInvitations.confirmOpen")}
        confirmLabel={t(open ? "tenantInvitations.close" : "tenantInvitations.open")}
        variant={open ? "primary" : "danger"}
        isLoading={busy}
        onConfirm={() => void change()}
        onCancel={() => setConfirming(false)}
      />
    </Dialog>
  );
}

export default UpstreamInvitationsPanel;
