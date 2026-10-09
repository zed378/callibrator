"use client";

/**
 * P22-01 — the tenant's catalogue proposals (`ipm-templates` read; write to propose and withdraw):
 * the tenant's own, newest first, and a form for a new one. Never offered to a facility-bound
 * account (the routes answer it 403) — the page leaves this panel out for one.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, CardContent, ConfirmDialog, Dialog, ErrorState, StatusBadge } from "@/components/ui";
import { useToastStore } from "@/stores/toastStore";
import { deferEffect } from "@/lib/deferEffect";
import { ipmCatalogueService, type CreateProposalBody, type Proposal, type ProposalQuery, type PublishedCatalogue } from "@/api/services/ipmCatalogue.service";
import { usePaged } from "../hooks/usePaged";
import { ProposalForm } from "./ProposalForm";
import { ActionError, FIELD, Pager, actionMessage, useCatalogueText } from "./shared";

type StatusFilter = NonNullable<ProposalQuery["status"]> | "";
const PAGE_SIZE = 25;
const STATUSES = ["submitted", "accepted", "rejected", "withdrawn"] as const;

export function ProposalsPanel({ canWrite }: { canWrite: boolean }) {
  const text = useCatalogueText();
  const { t } = text;
  const addToast = useToastStore((s) => s.addToast);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [catalogue, setCatalogue] = useState<PublishedCatalogue | null>(null);
  const [creating, setCreating] = useState(false);
  const [withdrawing, setWithdrawing] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const fetchPage = useCallback(
    (page: number) => ipmCatalogueService.listProposals({ page, limit: PAGE_SIZE, ...(statusFilter ? { status: statusFilter } : {}) }),
    [statusFilter],
  );
  const list = usePaged(fetchPage);

  // The type names, and the checklists a change or a retirement picks its item from.
  const loadCatalogue = useCallback(async () => {
    try {
      setCatalogue(await ipmCatalogueService.getPublishedCatalogue());
    } catch {
      setCatalogue(null);
    }
  }, []);
  useEffect(() => deferEffect(loadCatalogue), [loadCatalogue]);

  const typeName = (p: Proposal): string =>
    p.proposedDeviceTypeName ?? catalogue?.deviceTypes.find((d) => d.id === p.deviceTypeId)?.name ?? t("ipmCatalogue.unknownType");

  const create = async (body: CreateProposalBody) => {
    setBusy(true);
    setFailure(null);
    try {
      await ipmCatalogueService.createProposal(body);
      addToast({ type: "success", title: t("ipmCatalogue.proposals.created") });
      setCreating(false);
      await list.reload();
    } catch (err) {
      setFailure(actionMessage(err, t("ipmCatalogue.action.failed")));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!withdrawing) return;
    setBusy(true);
    setFailure(null);
    try {
      await ipmCatalogueService.withdrawProposal(withdrawing.id);
      addToast({ type: "success", title: t("ipmCatalogue.proposals.withdrawn") });
      await list.reload();
    } catch (err) {
      setFailure(actionMessage(err, t("ipmCatalogue.action.failed")));
    } finally {
      setWithdrawing(null);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("ipmCatalogue.proposals.heading")}</h2>
            {canWrite && (
              <Button disabled={catalogue === null} onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}>
                {t("ipmCatalogue.proposals.new")}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{t("ipmCatalogue.proposals.lead")}</p>
          <div className="max-w-xs space-y-1.5">
            <label htmlFor="proposals-status" className="block text-sm font-semibold">
              {t("ipmCatalogue.statusFilter")}
            </label>
            <select
              id="proposals-status"
              className={FIELD}
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                list.setPage(1);
              }}
            >
              <option value="">{t("ipmCatalogue.all")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {text.status(s)}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {!creating && <ActionError message={failure} onDismiss={() => setFailure(null)} />}

      <Card className="border-border">
        <CardContent className="pt-6">
          {list.loading && <p className="text-sm text-muted-foreground">{t("ipmCatalogue.loading")}</p>}
          {!list.loading && list.error !== null && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
          {!list.loading && list.error === null && list.rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("ipmCatalogue.proposals.empty")}</p>
          )}
          {!list.loading && list.error === null && list.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("ipmCatalogue.proposals.heading")}</caption>
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.proposals.kind")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.published.deviceType")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.proposals.items")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.statusColumn")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.proposals.submitted")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.proposals.decision")}</th>
                    {canWrite && <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.actions")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-3 py-2">{text.proposalKind(p.kind)}</td>
                      <td className="px-3 py-2 font-medium">{typeName(p)}</td>
                      <td className="px-3 py-2">{p.proposedItems.length}</td>
                      <td className="px-3 py-2">
                        <StatusBadge domain="templateProposal" state={p.status} size="sm">
                          {text.status(p.status)}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2">{text.date(p.createdAt)}</td>
                      <td className="px-3 py-2">
                        {p.decidedAt ? `${text.date(p.decidedAt)}${p.decisionNote ? ` — ${p.decisionNote}` : ""}` : "—"}
                      </td>
                      {canWrite && (
                        <td className="px-3 py-2">
                          {p.status === "submitted" && (
                            <Button size="sm" variant="ghost" aria-label={t("ipmCatalogue.proposals.withdrawNamed", { name: typeName(p) })} onClick={() => setWithdrawing(p)}>
                              {t("ipmCatalogue.proposals.withdraw")}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager meta={list.meta} onPage={list.setPage} label={t("ipmCatalogue.proposals.heading")} />
        </CardContent>
      </Card>

      <Dialog
        isOpen={creating}
        onClose={() => {
          setCreating(false);
          setFailure(null);
        }}
        title={t("ipmCatalogue.proposals.newTitle")}
        size="xl"
      >
        {failure !== null && (
          <div className="px-6 pt-4">
            <ActionError message={failure} onDismiss={() => setFailure(null)} />
          </div>
        )}
        {creating && catalogue !== null && (
          <ProposalForm
            catalogue={catalogue}
            busy={busy}
            onSubmit={(body) => void create(body)}
            onCancel={() => {
              setCreating(false);
              setFailure(null);
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        isOpen={withdrawing !== null}
        title={t("ipmCatalogue.proposals.withdrawTitle")}
        description={t("ipmCatalogue.proposals.withdrawBody")}
        confirmLabel={t("ipmCatalogue.proposals.withdraw")}
        cancelLabel={t("ipmCatalogue.cancel")}
        isLoading={busy}
        onConfirm={() => void withdraw()}
        onCancel={() => setWithdrawing(null)}
      />
    </div>
  );
}
