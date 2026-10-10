"use client";

/**
 * P22-01 — the operator's proposal queue (`/api/v1/admin/ipm/template-proposals`): every tenant's
 * proposals, oldest first. Read one; accept it (a draft is opened or linked on the type's checklist
 * — nothing is copied: the operator adds each item in the editor, so nothing that names a facility
 * or a person can slip into the global catalogue); reject it with a note. A new-type proposal is
 * accepted against the type the operator created first.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Button, Card, CardContent, Dialog, ErrorState, StatusBadge, Textarea } from "@/components/ui";
import { useToastStore } from "@/stores/toastStore";
import { deferEffect } from "@/lib/deferEffect";
import {
  ipmCatalogueService,
  type DeviceType,
  type ProposalQuery,
  type ProposalQueueRow,
  type PublishedCatalogue,
} from "@/api/services/ipmCatalogue.service";
import { usePaged } from "../hooks/usePaged";
import { DeviceTypePicker } from "./DeviceTypePicker";
import { ActionError, FIELD, Pager, actionMessage, useCatalogueText } from "./shared";

type StatusFilter = NonNullable<ProposalQuery["status"]> | "";
const PAGE_SIZE = 25;
const STATUSES = ["submitted", "accepted", "rejected", "withdrawn"] as const;

/** A proposed item's field as text (tenant text: shown, never trusted, never copied). */
const field = (item: Record<string, unknown>, key: string): string => {
  const value = item[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

export function ProposalQueuePanel() {
  const text = useCatalogueText();
  const { t } = text;
  const addToast = useToastStore((s) => s.addToast);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("submitted");
  const [catalogue, setCatalogue] = useState<PublishedCatalogue | null>(null);
  const [open, setOpen] = useState<ProposalQueueRow | null>(null);
  const [decision, setDecision] = useState<"accept" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [acceptType, setAcceptType] = useState<DeviceType | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const fetchPage = useCallback(
    (page: number) => ipmCatalogueService.listProposalQueue({ page, limit: PAGE_SIZE, ...(statusFilter ? { status: statusFilter } : {}) }),
    [statusFilter],
  );
  const list = usePaged(fetchPage);

  const loadCatalogue = useCallback(async () => {
    try {
      setCatalogue(await ipmCatalogueService.getPublishedCatalogue());
    } catch {
      setCatalogue(null);
    }
  }, []);
  useEffect(() => deferEffect(loadCatalogue), [loadCatalogue]);

  const typeName = (p: ProposalQueueRow): string =>
    p.proposedDeviceTypeName ?? catalogue?.deviceTypes.find((d) => d.id === p.deviceTypeId)?.name ?? t("ipmCatalogue.unknownType");

  const close = () => {
    setOpen(null);
    setDecision(null);
    setNote("");
    setAcceptType(null);
    setFailure(null);
  };

  const decide = async () => {
    if (!open || !decision) return;
    setBusy(true);
    setFailure(null);
    try {
      if (decision === "accept") {
        await ipmCatalogueService.acceptProposal(open.id, {
          ...(note.trim() ? { decisionNote: note.trim() } : {}),
          ...(open.kind === "new_device_type" && acceptType ? { deviceTypeId: acceptType.id } : {}),
        });
        addToast({ type: "success", title: t("ipmCatalogue.queue.accepted") });
      } else {
        await ipmCatalogueService.rejectProposal(open.id, note.trim());
        addToast({ type: "success", title: t("ipmCatalogue.queue.rejected") });
      }
      close();
      await list.reload();
    } catch (err) {
      setFailure(actionMessage(err, t("ipmCatalogue.action.failed")));
    } finally {
      setBusy(false);
    }
  };

  const noteOk = decision === "reject" ? note.trim().length >= 3 : note.trim() === "" || note.trim().length >= 3;
  const typeOk = decision !== "accept" || open?.kind !== "new_device_type" || acceptType !== null;

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{t("ipmCatalogue.queue.heading")}</h2>
          <p className="text-sm text-muted-foreground">{t("ipmCatalogue.queue.lead")}</p>
          <div className="max-w-xs space-y-1.5">
            <label htmlFor="queue-status" className="block text-sm font-semibold">
              {t("ipmCatalogue.statusFilter")}
            </label>
            <select
              id="queue-status"
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

      <Card className="border-border">
        <CardContent className="pt-6">
          {list.loading && <p className="text-sm text-muted-foreground">{t("ipmCatalogue.loading")}</p>}
          {!list.loading && list.error !== null && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
          {!list.loading && list.error === null && list.rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("ipmCatalogue.queue.empty")}</p>
          )}
          {!list.loading && list.error === null && list.rows.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("ipmCatalogue.queue.heading")}</caption>
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.proposals.submitted")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.proposals.kind")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.published.deviceType")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.proposals.items")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.statusColumn")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{text.date(p.createdAt)}</td>
                      <td className="px-3 py-2">{text.proposalKind(p.kind)}</td>
                      <td className="px-3 py-2 font-medium">{typeName(p)}</td>
                      <td className="px-3 py-2">{p.proposedItems.length}</td>
                      <td className="px-3 py-2">
                        <StatusBadge domain="templateProposal" state={p.status} size="sm">
                          {text.status(p.status)}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="outline" aria-label={t("ipmCatalogue.queue.reviewNamed", { name: typeName(p) })} onClick={() => setOpen(p)}>
                          {t("ipmCatalogue.queue.review")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager meta={list.meta} onPage={list.setPage} label={t("ipmCatalogue.queue.heading")} />
        </CardContent>
      </Card>

      <Dialog isOpen={open !== null} onClose={close} title={open ? `${text.proposalKind(open.kind)} · ${typeName(open)}` : ""} size="xl">
        {open && (
          <div className="p-6 space-y-4">
            <ActionError message={failure} onDismiss={() => setFailure(null)} />
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold">{t("ipmCatalogue.statusColumn")}</dt>
                <dd>{text.status(open.status)}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t("ipmCatalogue.proposals.submitted")}</dt>
                <dd>{text.date(open.createdAt)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold">{t("ipmCatalogue.queue.tenant")}</dt>
                <dd className="font-mono text-xs">{open.tenantId}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold">{t("ipmCatalogue.proposals.reason")}</dt>
                <dd className="whitespace-pre-wrap">{open.reason}</dd>
              </div>
            </dl>
            <section aria-labelledby="queue-items-heading">
              <h3 id="queue-items-heading" className="text-sm font-semibold mb-2">
                {t("ipmCatalogue.proposals.items")}
              </h3>
              {open.proposedItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("ipmCatalogue.proposals.noItems")}</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                  {open.proposedItems.map((item, i) => (
                    <li key={i} className="px-3 py-2">
                      <span className="font-medium">{field(item, "label")}</span>
                      <span className="ml-2 text-muted-foreground">
                        {[field(item, "section"), field(item, "inputKind"), field(item, "unit"), field(item, "limitText")].filter(Boolean).join(" · ")}
                      </span>
                      {field(item, "note") ? <p className="text-muted-foreground">{field(item, "note")}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {open.decisionNote && (
              <p className="text-sm">
                <span className="font-semibold">{t("ipmCatalogue.proposals.decision")}: </span>
                {open.decisionNote}
              </p>
            )}

            {open.status === "submitted" && decision === null && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setDecision("accept")}>{t("ipmCatalogue.queue.accept")}</Button>
                <Button variant="outline" onClick={() => setDecision("reject")}>
                  {t("ipmCatalogue.queue.reject")}
                </Button>
              </div>
            )}
            {decision !== null && (
              <form
                className="space-y-3 rounded-lg border border-border p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void decide();
                }}
              >
                <p className="text-sm">{decision === "accept" ? t("ipmCatalogue.queue.acceptBody") : t("ipmCatalogue.queue.rejectBody")}</p>
                {decision === "accept" && open.kind === "new_device_type" && (
                  <DeviceTypePicker id="accept-type" label={t("ipmCatalogue.queue.acceptType")} value={acceptType} onChange={setAcceptType} />
                )}
                <Textarea
                  label={decision === "reject" ? t("ipmCatalogue.queue.noteRequired") : t("ipmCatalogue.queue.noteOptional")}
                  required={decision === "reject"}
                  rows={3}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDecision(null)}>
                    {t("ipmCatalogue.cancel")}
                  </Button>
                  <Button type="submit" variant={decision === "reject" ? "danger" : "primary"} isLoading={busy} disabled={!noteOk || !typeOk}>
                    {decision === "accept" ? t("ipmCatalogue.queue.accept") : t("ipmCatalogue.queue.reject")}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
