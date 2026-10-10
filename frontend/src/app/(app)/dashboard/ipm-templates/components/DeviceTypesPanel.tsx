"use client";

/**
 * P22-01 — the device types (operator only): search, filter by status, create, rename, retire,
 * reactivate. A name is unique over every status; a clash is a 409 whose message says when the
 * existing type is retired and should be reactivated — shown in the panel as the backend wrote it.
 */
import React, { useCallback, useState } from "react";
import { Button, Card, CardContent, ConfirmDialog, Dialog, ErrorState, Input, StatusBadge } from "@/components/ui";
import { useToastStore } from "@/stores/toastStore";
import { ipmCatalogueService, type DeviceType, type DeviceTypeQuery } from "@/api/services/ipmCatalogue.service";
import { usePaged } from "../hooks/usePaged";
import { ActionError, FIELD, Pager, actionMessage, useCatalogueText } from "./shared";

type StatusFilter = NonNullable<DeviceTypeQuery["status"]>;
const PAGE_SIZE = 25;

export function DeviceTypesPanel() {
  const { t, status } = useCatalogueText();
  const addToast = useToastStore((s) => s.addToast);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DeviceType | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [retiring, setRetiring] = useState<DeviceType | null>(null);

  const fetchPage = useCallback(
    (page: number) =>
      ipmCatalogueService.listDeviceTypes({
        page,
        limit: PAGE_SIZE,
        status: statusFilter,
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
    [search, statusFilter],
  );
  const list = usePaged(fetchPage);

  const run = async (key: string, action: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(key);
    setFailure(null);
    try {
      await action();
      addToast({ type: "success", title: done });
      await list.reload();
      return true;
    } catch (err) {
      setFailure(actionMessage(err, t("ipmCatalogue.action.failed")));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (await run("create", () => ipmCatalogueService.createDeviceType(name), t("ipmCatalogue.types.created", { name }))) setNewName("");
  };

  const rename = async () => {
    if (!renaming || !renameTo.trim()) return;
    const target = renaming;
    if (await run("rename", () => ipmCatalogueService.renameDeviceType(target.id, renameTo.trim()), t("ipmCatalogue.types.renamed"))) setRenaming(null);
  };

  const retire = async () => {
    if (!retiring) return;
    const target = retiring;
    if (await run("retire", () => ipmCatalogueService.retireDeviceType(target.id), t("ipmCatalogue.types.retired", { name: target.name }))) setRetiring(null);
  };

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{t("ipmCatalogue.types.heading")}</h2>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void create(e)}>
            <div className="flex-1 min-w-48">
              <Input label={t("ipmCatalogue.types.newName")} value={newName} maxLength={255} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <Button type="submit" isLoading={busy === "create"} disabled={!newName.trim()}>
              {t("ipmCatalogue.types.create")}
            </Button>
          </form>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="types-search" className="block text-sm font-semibold">
                {t("ipmCatalogue.search")}
              </label>
              <input
                id="types-search"
                className={FIELD}
                value={search}
                maxLength={100}
                onChange={(e) => {
                  setSearch(e.target.value);
                  list.setPage(1);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="types-status" className="block text-sm font-semibold">
                {t("ipmCatalogue.statusFilter")}
              </label>
              <select
                id="types-status"
                className={FIELD}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilter);
                  list.setPage(1);
                }}
              >
                <option value="active">{status("active")}</option>
                <option value="retired">{status("retired")}</option>
                <option value="all">{t("ipmCatalogue.all")}</option>
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
            <p className="py-6 text-center text-sm text-muted-foreground">{t("ipmCatalogue.types.empty")}</p>
          )}
          {!list.loading && list.error === null && list.rows.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("ipmCatalogue.types.heading")}</caption>
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.types.name")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.statusColumn")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("ipmCatalogue.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((type) => (
                    <tr key={type.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium">{type.name}</td>
                      <td className="px-3 py-2">
                        <StatusBadge domain="catalogueLifecycle" state={type.status} size="sm">
                          {status(type.status)}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {type.status === "active" ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={t("ipmCatalogue.types.renameNamed", { name: type.name })}
                                onClick={() => {
                                  setRenaming(type);
                                  setRenameTo(type.name);
                                }}
                              >
                                {t("ipmCatalogue.types.rename")}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={t("ipmCatalogue.types.retireNamed", { name: type.name })}
                                onClick={() => setRetiring(type)}
                              >
                                {t("ipmCatalogue.retire")}
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              isLoading={busy === type.id}
                              aria-label={t("ipmCatalogue.types.reactivateNamed", { name: type.name })}
                              onClick={() =>
                                void run(type.id, () => ipmCatalogueService.reactivateDeviceType(type.id), t("ipmCatalogue.types.reactivated", { name: type.name }))
                              }
                            >
                              {t("ipmCatalogue.reactivate")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager meta={list.meta} onPage={list.setPage} label={t("ipmCatalogue.types.heading")} />
        </CardContent>
      </Card>

      <Dialog isOpen={renaming !== null} onClose={() => setRenaming(null)} title={t("ipmCatalogue.types.renameTitle")} size="md">
        <form
          className="p-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <Input label={t("ipmCatalogue.types.name")} value={renameTo} maxLength={255} onChange={(e) => setRenameTo(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
              {t("ipmCatalogue.cancel")}
            </Button>
            <Button type="submit" isLoading={busy === "rename"} disabled={!renameTo.trim()}>
              {t("ipmCatalogue.save")}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        isOpen={retiring !== null}
        title={t("ipmCatalogue.types.retireTitle", { name: retiring?.name ?? "" })}
        description={t("ipmCatalogue.types.retireBody")}
        confirmLabel={t("ipmCatalogue.retire")}
        cancelLabel={t("ipmCatalogue.cancel")}
        isLoading={busy === "retire"}
        onConfirm={() => void retire()}
        onCancel={() => setRetiring(null)}
      />
    </div>
  );
}
