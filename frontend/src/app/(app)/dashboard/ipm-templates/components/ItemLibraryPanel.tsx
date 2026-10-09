"use client";

/**
 * P22-01 — the item library (operator only): every item a checklist can be built from, filtered by
 * section, status and text; add, edit (a later copy into a draft sees the edit — existing drafts
 * and versions keep their copies), retire.
 */
import React, { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, CardContent, ConfirmDialog, Dialog, ErrorState, StatusBadge } from "@/components/ui";
import { useToastStore } from "@/stores/toastStore";
import { ipmCatalogueService, type ItemDefinition, type ItemDefinitionQuery } from "@/api/services/ipmCatalogue.service";
import { INSPECTION_SECTIONS, contentBodyOf, type InspectionSection } from "../catalogue";
import { usePaged } from "../hooks/usePaged";
import { ItemDefinitionForm, type ItemDefinitionDraft } from "./ItemDefinitionForm";
import { ActionError, FIELD, LimitText, Pager, actionMessage, useCatalogueText } from "./shared";

type StatusFilter = NonNullable<ItemDefinitionQuery["status"]>;
const PAGE_SIZE = 25;

export function ItemLibraryPanel() {
  const text = useCatalogueText();
  const { t } = text;
  const addToast = useToastStore((s) => s.addToast);
  const [section, setSection] = useState<InspectionSection | "">("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ItemDefinition | "new" | null>(null);
  const [retiring, setRetiring] = useState<ItemDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const fetchPage = useCallback(
    (page: number) =>
      ipmCatalogueService.listItemDefinitions({
        page,
        limit: PAGE_SIZE,
        status: statusFilter,
        ...(section ? { section } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
    [section, statusFilter, search],
  );
  const list = usePaged(fetchPage);

  const save = async (draft: ItemDefinitionDraft) => {
    setBusy(true);
    setFailure(null);
    const body = { content: contentBodyOf(draft.content), defaultRequired: draft.defaultRequired, notes: draft.notes };
    try {
      if (editing !== null && editing !== "new") {
        await ipmCatalogueService.updateItemDefinition(editing.id, body);
        addToast({ type: "success", title: t("ipmCatalogue.library.saved") });
      } else {
        await ipmCatalogueService.createItemDefinition(body);
        addToast({ type: "success", title: t("ipmCatalogue.library.created") });
      }
      setEditing(null);
      await list.reload();
    } catch (err) {
      // The dialog stays open with what the operator wrote; the reason shows inside it.
      setFailure(actionMessage(err, t("ipmCatalogue.action.failed")));
    } finally {
      setBusy(false);
    }
  };

  const retire = async () => {
    if (!retiring) return;
    setBusy(true);
    setFailure(null);
    try {
      await ipmCatalogueService.retireItemDefinition(retiring.id);
      addToast({ type: "success", title: t("ipmCatalogue.library.retired") });
      setRetiring(null);
      await list.reload();
    } catch (err) {
      setFailure(actionMessage(err, t("ipmCatalogue.action.failed")));
      setRetiring(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("ipmCatalogue.library.heading")}</h2>
            <Button onClick={() => setEditing("new")} leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}>
              {t("ipmCatalogue.library.add")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{t("ipmCatalogue.library.lead")}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="library-section" className="block text-sm font-semibold">
                {t("ipmCatalogue.items.section")}
              </label>
              <select
                id="library-section"
                className={FIELD}
                value={section}
                onChange={(e) => {
                  setSection(e.target.value as InspectionSection | "");
                  list.setPage(1);
                }}
              >
                <option value="">{t("ipmCatalogue.all")}</option>
                {INSPECTION_SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {text.section(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="library-status" className="block text-sm font-semibold">
                {t("ipmCatalogue.statusFilter")}
              </label>
              <select
                id="library-status"
                className={FIELD}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilter);
                  list.setPage(1);
                }}
              >
                <option value="active">{text.status("active")}</option>
                <option value="retired">{text.status("retired")}</option>
                <option value="all">{t("ipmCatalogue.all")}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="library-search" className="block text-sm font-semibold">
                {t("ipmCatalogue.search")}
              </label>
              <input
                id="library-search"
                className={FIELD}
                maxLength={100}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  list.setPage(1);
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {editing === null && <ActionError message={failure} onDismiss={() => setFailure(null)} />}

      <Card className="border-border">
        <CardContent className="pt-6">
          {list.loading && <p className="text-sm text-muted-foreground">{t("ipmCatalogue.loading")}</p>}
          {!list.loading && list.error !== null && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
          {!list.loading && list.error === null && list.rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("ipmCatalogue.library.empty")}</p>
          )}
          {!list.loading && list.error === null && list.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("ipmCatalogue.library.heading")}</caption>
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.items.label")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.items.section")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.items.kind")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.items.unit")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.items.limit")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.statusColumn")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((d) => (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium">{d.label}</td>
                      <td className="px-3 py-2">{text.section(d.section)}</td>
                      <td className="px-3 py-2">{text.kind(d.inputKind)}</td>
                      <td className="px-3 py-2">{d.unit ?? "—"}</td>
                      <td className="px-3 py-2">
                        <LimitText text={d.limitText} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge domain="catalogueLifecycle" state={d.status} size="sm">
                          {text.status(d.status)}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2">
                        {d.status === "active" && (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" aria-label={t("ipmCatalogue.library.editNamed", { name: d.label })} onClick={() => setEditing(d)}>
                              {t("ipmCatalogue.edit")}
                            </Button>
                            <Button size="sm" variant="ghost" aria-label={t("ipmCatalogue.library.retireNamed", { name: d.label })} onClick={() => setRetiring(d)}>
                              {t("ipmCatalogue.retire")}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager meta={list.meta} onPage={list.setPage} label={t("ipmCatalogue.library.heading")} />
        </CardContent>
      </Card>

      <Dialog
        isOpen={editing !== null}
        onClose={() => {
          setEditing(null);
          setFailure(null);
        }}
        title={editing === "new" ? t("ipmCatalogue.library.addTitle") : t("ipmCatalogue.library.editTitle")}
        size="xl"
      >
        {editing !== null && failure !== null && (
          <div className="px-6 pt-4">
            <ActionError message={failure} onDismiss={() => setFailure(null)} />
          </div>
        )}
        {editing !== null && (
          <ItemDefinitionForm
            key={editing === "new" ? "new" : editing.id}
            editing={editing === "new" ? undefined : editing}
            busy={busy}
            onSubmit={(draft) => void save(draft)}
            onCancel={() => {
              setEditing(null);
              setFailure(null);
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        isOpen={retiring !== null}
        title={t("ipmCatalogue.library.retireTitle", { name: retiring?.label ?? "" })}
        description={t("ipmCatalogue.library.retireBody")}
        confirmLabel={t("ipmCatalogue.retire")}
        cancelLabel={t("ipmCatalogue.cancel")}
        isLoading={busy}
        onConfirm={() => void retire()}
        onCancel={() => setRetiring(null)}
      />
    </div>
  );
}
