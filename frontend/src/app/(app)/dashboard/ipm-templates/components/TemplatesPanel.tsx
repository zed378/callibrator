"use client";

/**
 * P22-01 — the checklists (operator only): the base checklist and one per device type, each with
 * its published version and open draft (`GET /ipm/templates`); create a type's checklist; open one
 * in the editor.
 */
import React, { useCallback, useState } from "react";
import { Button, Card, CardContent, ErrorState, StatusBadge } from "@/components/ui";
import { useToastStore } from "@/stores/toastStore";
import { ipmCatalogueService, type DeviceType, type InspectionTemplate } from "@/api/services/ipmCatalogue.service";
import { usePaged } from "../hooks/usePaged";
import { DeviceTypePicker } from "./DeviceTypePicker";
import { TemplateEditor } from "./TemplateEditor";
import { ActionError, FIELD, Pager, actionMessage, useCatalogueText } from "./shared";

const PAGE_SIZE = 25;
type StatusFilter = "" | "active" | "retired";
type DraftFilter = "" | "yes" | "no";

export function TemplatesPanel() {
  const text = useCatalogueText();
  const { t } = text;
  const addToast = useToastStore((s) => s.addToast);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [draftFilter, setDraftFilter] = useState<DraftFilter>("");
  const [selected, setSelected] = useState<InspectionTemplate | null>(null);
  const [newType, setNewType] = useState<DeviceType | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const fetchPage = useCallback(
    (page: number) =>
      ipmCatalogueService.listTemplates({
        page,
        limit: PAGE_SIZE,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(draftFilter ? { hasDraft: draftFilter === "yes" } : {}),
      }),
    [statusFilter, draftFilter],
  );
  const list = usePaged(fetchPage);

  const nameOf = (template: InspectionTemplate): string =>
    template.deviceTypeId === null ? t("ipmCatalogue.base") : (template.deviceTypeName ?? t("ipmCatalogue.unknownType"));

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newType) return;
    setBusy(true);
    setFailure(null);
    try {
      const template = await ipmCatalogueService.createTemplate(newType.id);
      addToast({ type: "success", title: t("ipmCatalogue.templates.created", { name: newType.name }) });
      setNewType(null);
      await list.reload();
      setSelected(template);
    } catch (err) {
      setFailure(actionMessage(err, t("ipmCatalogue.action.failed")));
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <TemplateEditor
        key={selected.id}
        template={selected}
        name={nameOf(selected)}
        onBack={() => {
          setSelected(null);
          void list.reload();
        }}
        onChanged={() => void list.reload()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{t("ipmCatalogue.templates.heading")}</h2>
          <p className="text-sm text-muted-foreground">{t("ipmCatalogue.templates.lead")}</p>
          <form className="space-y-3" onSubmit={(e) => void create(e)}>
            <DeviceTypePicker id="new-template-type" label={t("ipmCatalogue.templates.forType")} value={newType} onChange={setNewType} />
            <Button type="submit" isLoading={busy} disabled={newType === null}>
              {t("ipmCatalogue.templates.create")}
            </Button>
          </form>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="templates-status" className="block text-sm font-semibold">
                {t("ipmCatalogue.statusFilter")}
              </label>
              <select
                id="templates-status"
                className={FIELD}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilter);
                  list.setPage(1);
                }}
              >
                <option value="active">{text.status("active")}</option>
                <option value="retired">{text.status("retired")}</option>
                <option value="">{t("ipmCatalogue.all")}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="templates-draft" className="block text-sm font-semibold">
                {t("ipmCatalogue.templates.draftFilter")}
              </label>
              <select
                id="templates-draft"
                className={FIELD}
                value={draftFilter}
                onChange={(e) => {
                  setDraftFilter(e.target.value as DraftFilter);
                  list.setPage(1);
                }}
              >
                <option value="">{t("ipmCatalogue.all")}</option>
                <option value="yes">{t("ipmCatalogue.templates.withDraft")}</option>
                <option value="no">{t("ipmCatalogue.templates.withoutDraft")}</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <ActionError message={failure} onDismiss={() => setFailure(null)} />

      <Card className="border-border">
        <CardContent className="pt-6">
          {list.loading && <p className="text-sm text-muted-foreground">{t("ipmCatalogue.loading")}</p>}
          {!list.loading && list.error !== null && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
          {!list.loading && list.error === null && list.rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("ipmCatalogue.templates.empty")}</p>
          )}
          {!list.loading && list.error === null && list.rows.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("ipmCatalogue.templates.heading")}</caption>
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.templates.checklist")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.statusColumn")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.templates.published")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.templates.draft")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((tpl) => {
                    const name = nameOf(tpl);
                    return (
                      <tr key={tpl.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium">{name}</td>
                        <td className="px-3 py-2">
                          <StatusBadge domain="catalogueLifecycle" state={tpl.status} size="sm">
                            {text.status(tpl.status)}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2">
                          {tpl.publishedVersion
                            ? `${t("ipmCatalogue.version", { n: tpl.publishedVersion.versionNumber ?? "—" })} · ${text.date(tpl.publishedVersion.publishedAt)}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {tpl.openDraft ? t("ipmCatalogue.templates.draftOpen", { revision: tpl.openDraft.revision, date: text.date(tpl.openDraft.createdAt) }) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Button size="sm" variant="outline" aria-label={t("ipmCatalogue.templates.openNamed", { name })} onClick={() => setSelected(tpl)}>
                            {t("ipmCatalogue.templates.open")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pager meta={list.meta} onPage={list.setPage} label={t("ipmCatalogue.templates.heading")} />
        </CardContent>
      </Card>
    </div>
  );
}
