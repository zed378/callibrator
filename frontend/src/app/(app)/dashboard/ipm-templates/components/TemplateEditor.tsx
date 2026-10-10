"use client";

/**
 * P22-01 — one checklist (operator only): its version history, its open draft and the draft's
 * editor (P19-01 spec § 7.2, § 7.3).
 *
 *  - A draft is edited as a document: add items from the library, remove them, order them inside
 *    their section, mark them required; "Save items" replaces the draft's items at the revision
 *    the editor read. Another save in between is a 409 — the editor offers to reload.
 *  - An item already in the draft is sent back with its own copy of the content, so a save never
 *    swaps the draft's copy for a later library edit; an item added from the library is copied by
 *    the server.
 *  - Publishing needs a change note and no unsaved edits; publishing the BASE checklist also
 *    publishes a rebased version of every published type checklist, and the confirmation says so.
 *  - Every refusal (409 state, 400 publish problems) is shown in the panel as the backend wrote it.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Card, CardContent, ConfirmDialog, Dialog, ErrorState, StatusBadge, Textarea } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import { deferEffect } from "@/lib/deferEffect";
import {
  ipmCatalogueService,
  type InspectionTemplate,
  type ItemDefinition,
  type TemplateVersion,
} from "@/api/services/ipmCatalogue.service";
import { INSPECTION_SECTIONS, draftItemsOf, draftRowOfDefinition, draftRowsOf, moveInSection, orderedItems, type DraftRow, type InspectionSection } from "../catalogue";
import { usePaged } from "../hooks/usePaged";
import { ActionError, FIELD, LimitText, Pager, SectionItems, actionMessage, useCatalogueText } from "./shared";

const HISTORY_PAGE = 10;
const LIBRARY_MATCHES = 50;

interface Props {
  template: InspectionTemplate;
  /** The checklist's name as the list shows it. */
  name: string;
  onBack: () => void;
  /** After anything that changes the list's row (a draft opened, published, discarded; retired). */
  onChanged: () => void;
}

export function TemplateEditor({ template, name, onBack, onChanged }: Props) {
  const text = useCatalogueText();
  const { t } = text;
  const addToast = useToastStore((s) => s.addToast);
  const isBase = template.deviceTypeId === null;

  const [draftId, setDraftId] = useState<string | null>(template.openDraft?.id ?? null);
  const [draft, setDraft] = useState<TemplateVersion | null>(null);
  const [draftError, setDraftError] = useState<unknown>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "discard" | "retire" | null>(null);
  const [viewing, setViewing] = useState<TemplateVersion | null>(null);
  const [status, setStatus] = useState(template.status);

  const [librarySection, setLibrarySection] = useState<InspectionSection | "">("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [library, setLibrary] = useState<ItemDefinition[]>([]);
  const [libraryFailed, setLibraryFailed] = useState(false);

  const fetchHistory = useCallback((page: number) => ipmCatalogueService.listVersions(template.id, page, HISTORY_PAGE), [template.id]);
  const history = usePaged(fetchHistory);

  const adopt = (version: TemplateVersion) => {
    setDraft(version);
    setRows(draftRowsOf(version.items));
    setNote(version.changeNote ?? "");
    setDirty(false);
    setStale(false);
  };

  const loadDraft = useCallback(async () => {
    if (draftId === null) {
      setDraft(null);
      return;
    }
    setDraftError(null);
    try {
      const version = await ipmCatalogueService.getVersion(draftId);
      setDraft(version);
      setRows(draftRowsOf(version.items));
      setNote(version.changeNote ?? "");
      setDirty(false);
      setStale(false);
    } catch (err) {
      setDraftError(err);
    }
  }, [draftId]);

  useEffect(() => deferEffect(loadDraft), [loadDraft]);

  // The library's matches for the add list, while a draft is open.
  useEffect(() => {
    if (draftId === null) return;
    let live = true;
    const timer = setTimeout(() => {
      ipmCatalogueService
        .listItemDefinitions({
          status: "active",
          limit: LIBRARY_MATCHES,
          ...(librarySection ? { section: librarySection } : {}),
          ...(librarySearch.trim() ? { search: librarySearch.trim() } : {}),
        })
        .then((page) => {
          if (!live) return;
          setLibrary(page.rows);
          setLibraryFailed(false);
        })
        .catch(() => {
          if (live) setLibraryFailed(true);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draftId, librarySection, librarySearch]);

  const fail = (err: unknown) => {
    const details = describeApiError(err);
    setFailure(actionMessage(err, t("ipmCatalogue.action.failed")));
    // A 409 on a draft is a stale revision or a draft that is no longer one: offer the reload.
    if (details.status === 409) setStale(true);
  };

  const act = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setFailure(null);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const openDraft = (copyFrom: "published" | "empty") =>
    act("open", async () => {
      const version = await ipmCatalogueService.openDraft(template.id, copyFrom);
      setDraftId(version.id);
      adopt(version);
      addToast({ type: "success", title: t("ipmCatalogue.editor.opened") });
      onChanged();
      await history.reload();
    });

  const saveItems = () =>
    act("save", async () => {
      if (!draft) return;
      const version = await ipmCatalogueService.saveDraftItems(draft.id, draft.revision, draftItemsOf(rows));
      adopt(version);
      addToast({ type: "success", title: t("ipmCatalogue.editor.saved") });
    });

  const saveNote = () =>
    act("note", async () => {
      if (!draft) return;
      const version = await ipmCatalogueService.saveDraftNote(draft.id, draft.revision, note.trim());
      setDraft({ ...draft, revision: version.revision, changeNote: version.changeNote });
      addToast({ type: "success", title: t("ipmCatalogue.editor.noteSaved") });
    });

  const publish = () =>
    act("publish", async () => {
      if (!draft) return;
      setConfirm(null);
      const result = await ipmCatalogueService.publishDraft(draft.id, draft.revision, note.trim());
      addToast({
        type: "success",
        title: t("ipmCatalogue.editor.published", { n: result.version.versionNumber ?? "—" }),
        ...(result.rebasedVersionIds.length > 0 ? { description: t("ipmCatalogue.editor.rebased", { count: result.rebasedVersionIds.length }) } : {}),
      });
      setDraftId(null);
      setDraft(null);
      setRows([]);
      onChanged();
      await history.reload();
    });

  const discard = () =>
    act("discard", async () => {
      if (!draft) return;
      setConfirm(null);
      await ipmCatalogueService.discardDraft(draft.id);
      addToast({ type: "success", title: t("ipmCatalogue.editor.discarded") });
      setDraftId(null);
      setDraft(null);
      setRows([]);
      onChanged();
      await history.reload();
    });

  const lifecycle = (retire: boolean) =>
    act("lifecycle", async () => {
      setConfirm(null);
      const answer = retire ? await ipmCatalogueService.retireTemplate(template.id) : await ipmCatalogueService.reactivateTemplate(template.id);
      setStatus(answer.status);
      addToast({ type: "success", title: retire ? t("ipmCatalogue.editor.retiredTemplate") : t("ipmCatalogue.editor.reactivatedTemplate") });
      onChanged();
      await history.reload();
    });

  const view = (versionId: string) =>
    act(`view-${versionId}`, async () => {
      setViewing(await ipmCatalogueService.getVersion(versionId));
    });

  const edit = (next: DraftRow[]) => {
    setRows(next);
    setDirty(true);
  };

  const inDraft = new Set(rows.map((r) => r.itemDefinitionId));
  const noteValid = note.trim().length >= 3 && note.trim().length <= 2000;

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardContent className="pt-6 space-y-3">
          <Button size="sm" variant="ghost" onClick={onBack}>
            {t("ipmCatalogue.editor.back")}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{name}</h2>
              <p className="text-sm text-muted-foreground">
                {template.publishedVersion
                  ? t("ipmCatalogue.editor.publishedNow", { n: template.publishedVersion.versionNumber ?? "—", date: text.date(template.publishedVersion.publishedAt) })
                  : t("ipmCatalogue.editor.nonePublished")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge domain="catalogueLifecycle" state={status} size="sm">
                {text.status(status)}
              </StatusBadge>
              {!isBase && status === "active" && (
                <Button size="sm" variant="ghost" onClick={() => setConfirm("retire")}>
                  {t("ipmCatalogue.editor.retireTemplate")}
                </Button>
              )}
              {!isBase && status === "retired" && (
                <Button size="sm" variant="outline" isLoading={busy === "lifecycle"} onClick={() => void lifecycle(false)}>
                  {t("ipmCatalogue.reactivate")}
                </Button>
              )}
            </div>
          </div>
          {isBase && <p className="text-sm text-muted-foreground">{t("ipmCatalogue.editor.baseNote")}</p>}
        </CardContent>
      </Card>

      <ActionError message={failure} onDismiss={() => setFailure(null)} />
      {stale && draftId !== null && (
        <Button size="sm" variant="outline" onClick={() => void loadDraft()}>
          {t("ipmCatalogue.editor.reload")}
        </Button>
      )}

      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <h3 className="text-base font-semibold">{t("ipmCatalogue.editor.draftHeading")}</h3>
          {draftId === null && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("ipmCatalogue.editor.noDraft")}</p>
              {status === "active" ? (
                <div className="flex flex-wrap gap-2">
                  {template.publishedVersion && (
                    <Button isLoading={busy === "open"} onClick={() => void openDraft("published")}>
                      {t("ipmCatalogue.editor.openCopy")}
                    </Button>
                  )}
                  <Button variant={template.publishedVersion ? "outline" : "primary"} isLoading={busy === "open"} onClick={() => void openDraft("empty")}>
                    {t("ipmCatalogue.editor.openEmpty")}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("ipmCatalogue.editor.retiredNoDraft")}</p>
              )}
            </div>
          )}
          {draftId !== null && draftError !== null && <ErrorState error={draftError} onRetry={() => void loadDraft()} />}
          {draftId !== null && draftError === null && draft === null && <p className="text-sm text-muted-foreground">{t("ipmCatalogue.loading")}</p>}
          {draft !== null && (
            <>
              <p className="text-sm text-muted-foreground">
                {t("ipmCatalogue.editor.draftMeta", { revision: draft.revision, date: text.date(draft.updatedAt), count: rows.length })}
              </p>
              <SectionItems
                items={rows.map((r, rowIndex) => ({ ...r.shown, required: r.required, rowIndex }))}
                indexOf={(item) => item.rowIndex}
                actionsHeader={t("ipmCatalogue.actions")}
                actions={(item, index) => {
                  const row = rows[index];
                  if (!row) return null;
                  return (
                    <div className="flex items-center gap-1">
                      <label className="mr-2 flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={row.required}
                          aria-label={t("ipmCatalogue.editor.requiredNamed", { name: item.label })}
                          onChange={(e) => edit(rows.map((r, i) => (i === index ? { ...r, required: e.target.checked } : r)))}
                        />
                        <span aria-hidden="true">{t("ipmCatalogue.items.required")}</span>
                      </label>
                      <Button size="sm" variant="ghost" aria-label={t("ipmCatalogue.editor.upNamed", { name: item.label })} onClick={() => edit(moveInSection(rows, index, -1))}>
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={t("ipmCatalogue.editor.downNamed", { name: item.label })} onClick={() => edit(moveInSection(rows, index, 1))}>
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={t("ipmCatalogue.editor.removeNamed", { name: item.label })} onClick={() => edit(rows.filter((_, i) => i !== index))}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  );
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button isLoading={busy === "save"} disabled={!dirty} onClick={() => void saveItems()}>
                  {t("ipmCatalogue.editor.saveItems")}
                </Button>
                {dirty && <span className="text-sm text-muted-foreground">{t("ipmCatalogue.editor.unsaved")}</span>}
              </div>

              <section aria-labelledby="library-add-heading" className="space-y-3 rounded-lg border border-border p-4">
                <h4 id="library-add-heading" className="text-sm font-semibold">
                  {t("ipmCatalogue.editor.addHeading")}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="add-section" className="block text-sm font-semibold">
                      {t("ipmCatalogue.items.section")}
                    </label>
                    <select id="add-section" className={FIELD} value={librarySection} onChange={(e) => setLibrarySection(e.target.value as InspectionSection | "")}>
                      <option value="">{t("ipmCatalogue.all")}</option>
                      {INSPECTION_SECTIONS.map((s) => (
                        <option key={s} value={s}>
                          {text.section(s)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="add-search" className="block text-sm font-semibold">
                      {t("ipmCatalogue.search")}
                    </label>
                    <input id="add-search" className={FIELD} maxLength={100} value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} />
                  </div>
                </div>
                {libraryFailed && (
                  <p role="alert" className="text-sm text-destructive">
                    {t("ipmCatalogue.editor.libraryFailed")}
                  </p>
                )}
                {!libraryFailed && library.length === 0 && <p className="text-sm text-muted-foreground">{t("ipmCatalogue.library.empty")}</p>}
                {library.length > 0 && (
                  <ul className="divide-y divide-border">
                    {library.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span>
                          <span className="font-medium">{d.label}</span>
                          <span className="ml-2 text-muted-foreground">
                            {text.section(d.section)} · {text.kind(d.inputKind)}
                          </span>
                          {d.limitText ? (
                            <span className="ml-2">
                              <LimitText text={d.limitText} />
                            </span>
                          ) : null}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={inDraft.has(d.id)}
                          aria-label={t("ipmCatalogue.editor.addNamed", { name: d.label })}
                          leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                          onClick={() => edit([...rows, draftRowOfDefinition(d)])}
                        >
                          {inDraft.has(d.id) ? t("ipmCatalogue.editor.added") : t("ipmCatalogue.editor.add")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="space-y-3">
                <Textarea
                  label={t("ipmCatalogue.editor.changeNote")}
                  helperText={t("ipmCatalogue.editor.changeNoteHelp")}
                  rows={3}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" isLoading={busy === "note"} disabled={!noteValid} onClick={() => void saveNote()}>
                    {t("ipmCatalogue.editor.saveNote")}
                  </Button>
                  <Button isLoading={busy === "publish"} disabled={!noteValid || dirty} onClick={() => setConfirm("publish")}>
                    {t("ipmCatalogue.editor.publish")}
                  </Button>
                  <Button variant="ghost" isLoading={busy === "discard"} onClick={() => setConfirm("discard")}>
                    {t("ipmCatalogue.editor.discard")}
                  </Button>
                </div>
                {dirty && <p className="text-xs text-muted-foreground">{t("ipmCatalogue.editor.saveFirst")}</p>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardContent className="pt-6 space-y-3">
          <h3 className="text-base font-semibold">{t("ipmCatalogue.editor.history")}</h3>
          {history.loading && <p className="text-sm text-muted-foreground">{t("ipmCatalogue.loading")}</p>}
          {!history.loading && history.error !== null && <ErrorState error={history.error} onRetry={() => void history.reload()} />}
          {!history.loading && history.error === null && history.rows.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("ipmCatalogue.editor.noHistory")}</p>
          )}
          {!history.loading && history.error === null && history.rows.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("ipmCatalogue.editor.history")}</caption>
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.editor.versionColumn")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.statusColumn")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.editor.changeNote")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.editor.dateColumn")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map((v) => {
                    const label = v.versionNumber === null ? t("ipmCatalogue.status.draft") : t("ipmCatalogue.version", { n: v.versionNumber });
                    return (
                      <tr key={v.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium">
                          {label}
                          {v.rebasedFromVersionId ? <span className="ml-2 text-xs text-muted-foreground">{t("ipmCatalogue.editor.rebasedTag")}</span> : null}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge domain="templateVersion" state={v.status} size="sm">
                            {text.status(v.status)}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2">{v.changeNote ?? "—"}</td>
                        <td className="px-3 py-2">{text.date(v.publishedAt ?? v.discardedAt ?? v.createdAt)}</td>
                        <td className="px-3 py-2">
                          {(v.status === "published" || v.status === "retired") && (
                            <Button size="sm" variant="outline" isLoading={busy === `view-${v.id}`} aria-label={t("ipmCatalogue.editor.viewNamed", { name: label })} onClick={() => void view(v.id)}>
                              {t("ipmCatalogue.editor.view")}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pager meta={history.meta} onPage={history.setPage} label={t("ipmCatalogue.editor.history")} />
        </CardContent>
      </Card>

      <Dialog
        isOpen={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? `${name} · ${t("ipmCatalogue.version", { n: viewing.versionNumber ?? "—" })}` : ""}
        size="xl"
      >
        {viewing && (
          <div className="p-6 space-y-3">
            <p className="text-xs text-muted-foreground">
              {text.status(viewing.status)} · {text.date(viewing.publishedAt)}
              {viewing.contentHash ? ` · ${viewing.contentHash.slice(0, 12)}` : ""}
            </p>
            <SectionItems items={orderedItems(viewing.items)} />
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        isOpen={confirm === "publish"}
        variant="primary"
        title={t("ipmCatalogue.editor.publishTitle", { name })}
        description={isBase ? t("ipmCatalogue.editor.publishBaseBody") : t("ipmCatalogue.editor.publishBody")}
        confirmLabel={t("ipmCatalogue.editor.publish")}
        cancelLabel={t("ipmCatalogue.cancel")}
        onConfirm={() => void publish()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        isOpen={confirm === "discard"}
        title={t("ipmCatalogue.editor.discardTitle")}
        description={t("ipmCatalogue.editor.discardBody")}
        confirmLabel={t("ipmCatalogue.editor.discard")}
        cancelLabel={t("ipmCatalogue.cancel")}
        onConfirm={() => void discard()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        isOpen={confirm === "retire"}
        title={t("ipmCatalogue.editor.retireTitle", { name })}
        description={t("ipmCatalogue.editor.retireBody")}
        confirmLabel={t("ipmCatalogue.retire")}
        cancelLabel={t("ipmCatalogue.cancel")}
        onConfirm={() => void lifecycle(true)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
