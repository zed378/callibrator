"use client";

/**
 * P22-09 (F-13 … F-17; P19-04 § 4 – § 6, § 10; built by P21-09b/c) — the client facilities a
 * calibration company serves, administered by its tenant administrators: the list (search, status,
 * kind; the tenant's own facility marked), create, edit, the status (with a reason; leaving
 * `active` signs the facility's users out), delete, and the facility's users with their binding.
 *
 * What a caller sees follows the effective permissions (ADR-102): `client-facilities` read for the
 * list, write for create / edit / status / delete (the server also keeps delete and `ended →
 * active` to the tenant administrator role, explained when refused); the binding needs `users`
 * write. **A facility-bound account never administers facilities** (every route here answers it
 * 403 `FACILITY_ROUTE_REFUSED`): the page tells it so and reads nothing.
 *
 * Loading, empty and failed are three states. Bilingual (the `facilities.` namespace).
 */
import React, { useCallback, useState } from "react";
import { Building2, Edit, Plus, Search, Shield, ToggleLeft, Trash2, Users } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Card, CardContent, ConfirmDialog, ErrorState, StatusBadge } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { clientFacilityService, type ClientFacility } from "@/api/services/clientFacility.service";
import { usePermissions } from "@/hooks/usePermissions";
import { usePaged } from "@/hooks/usePaged";
import { useToastStore } from "@/stores/toastStore";
import { useI18n } from "@/i18n/MessagesProvider";
import { KINDS, STATUSES, listQuery, type Kind, type Status } from "./facilities";
import { FIELD, FacilityFormDialog, StatusDialog, UsersDialog, useFacilityText } from "./components/dialogs";

export function FacilitiesClient({ languageForm }: { languageForm?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const permissions = usePermissions();
  if (!permissions.loaded) {
    return (
      <DashboardLayout>
        <div lang={locale}>
          <h1 className="sr-only">{t("facilities.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("facilities.loading")}</p>
        </div>
      </DashboardLayout>
    );
  }
  const refused = !permissions.canRead("client-facilities") || permissions.facilityBound;
  if (refused) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center" lang={locale}>
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">{t("facilities.title")}</h1>
          <p className="text-muted-foreground">{permissions.facilityBound ? t("facilities.bound") : t("facilities.restricted")}</p>
        </div>
      </DashboardLayout>
    );
  }
  return (
    <DashboardLayout>
      <div lang={locale}>
        <Facilities write={permissions.canWrite("client-facilities")} canBind={permissions.canWrite("users")} languageForm={languageForm} />
      </div>
    </DashboardLayout>
  );
}

function Facilities({ write, canBind, languageForm }: { write: boolean; canBind: boolean; languageForm?: React.ReactNode }) {
  const text = useFacilityText();
  const { t } = text;
  const addToast = useToastStore((s) => s.addToast);
  const [filters, setFilters] = useState<{ q: string; status: "" | Status; kind: "" | Kind }>({ q: "", status: "", kind: "" });
  const [editing, setEditing] = useState<ClientFacility | null | undefined>(undefined);
  const [statusOf, setStatusOf] = useState<ClientFacility | null>(null);
  const [usersOf, setUsersOf] = useState<ClientFacility | null>(null);
  const [deleting, setDeleting] = useState<ClientFacility | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const fetchPage = useCallback((page: number) => clientFacilityService.list(listQuery(filters, page)), [filters]);
  const list = usePaged(fetchPage);
  const { setPage, reload } = list;
  const change = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setRemoving(true);
    setDeleteError(null);
    try {
      await clientFacilityService.remove(deleting.id);
      addToast({ type: "success", title: t("facilities.deleted", { name: deleting.name }) });
      setDeleting(null);
      void reload();
    } catch (err) {
      setDeleteError(describeApiError(err).message || t("facilities.saveFailed"));
    } finally {
      setRemoving(false);
    }
  };

  const meta = list.meta;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" aria-hidden="true" />
            {t("facilities.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{t("facilities.lead")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {languageForm}
          {write && (
            <Button leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing(null)}>
              {t("facilities.add")}
            </Button>
          )}
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="pt-6 grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="facilities-q" className="block text-sm font-semibold">
              {t("facilities.filters.q")}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input id="facilities-q" type="search" className={`${FIELD} pl-9`} maxLength={100} value={filters.q} onChange={(e) => change({ q: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="facilities-status" className="block text-sm font-semibold">
              {t("facilities.filters.status")}
            </label>
            <select id="facilities-status" className={FIELD} value={filters.status} onChange={(e) => change({ status: e.target.value as "" | Status })}>
              <option value="">{t("facilities.filters.all")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {text.status(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="facilities-kind" className="block text-sm font-semibold">
              {t("facilities.filters.kind")}
            </label>
            <select id="facilities-kind" className={FIELD} value={filters.kind} onChange={(e) => change({ kind: e.target.value as "" | Kind })}>
              <option value="">{t("facilities.filters.all")}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {text.kind(k)}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardContent className="p-0">
          {list.loading && <p className="p-6 text-sm text-muted-foreground">{t("facilities.loading")}</p>}
          {!list.loading && list.error !== null && (
            <div className="p-6">
              <ErrorState error={list.error} onRetry={() => void reload()} />
            </div>
          )}
          {!list.loading && list.error === null && list.rows.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-base font-medium">{t("facilities.empty")}</p>
            </div>
          )}
          {!list.loading && list.error === null && list.rows.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("facilities.title")}</caption>
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 font-medium">{t("facilities.col.name")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("facilities.col.kind")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("facilities.col.status")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("facilities.col.city")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("facilities.col.contact")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      <span className="sr-only">{t("facilities.col.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((f) => (
                    <tr key={f.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-3 py-2">
                        <span className="font-semibold">{f.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{f.code}</span>
                        {f.isSelf && <span className="block text-xs text-muted-foreground">{t("facilities.self")}</span>}
                      </td>
                      <td className="px-3 py-2">{text.kind(f.kind)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge domain="clientFacility" state={f.status} size="sm">
                          {text.status(f.status)}
                        </StatusBadge>
                        {f.statusReason && <span className="mt-1 block text-xs text-muted-foreground">{f.statusReason}</span>}
                      </td>
                      <td className="px-3 py-2">{f.city ?? "—"}</td>
                      <td className="px-3 py-2">{[f.contactName, f.contactPhone, f.contactEmail].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" aria-label={t("facilities.action.users", { name: f.name })} onClick={() => setUsersOf(f)}>
                            <Users className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          {write && !f.isSelf && (
                            <>
                              <Button variant="ghost" size="sm" aria-label={t("facilities.action.edit", { name: f.name })} onClick={() => setEditing(f)}>
                                <Edit className="h-4 w-4" aria-hidden="true" />
                              </Button>
                              <Button variant="ghost" size="sm" aria-label={t("facilities.action.status", { name: f.name })} onClick={() => setStatusOf(f)}>
                                <ToggleLeft className="h-4 w-4" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                aria-label={t("facilities.action.delete", { name: f.name })}
                                onClick={() => {
                                  setDeleteError(null);
                                  setDeleting(f);
                                }}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {meta && meta.totalPages > 1 && (
            <nav aria-label={t("facilities.title")} className="flex flex-wrap items-center justify-between gap-2 p-4 border-t border-border">
              <p className="text-sm text-muted-foreground">{t("facilities.pager", { page: meta.page, pages: meta.totalPages, total: meta.total })}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={meta.page <= 1} onClick={() => setPage(meta.page - 1)}>
                  {t("facilities.previous")}
                </Button>
                <Button size="sm" variant="outline" disabled={meta.page >= meta.totalPages} onClick={() => setPage(meta.page + 1)}>
                  {t("facilities.next")}
                </Button>
              </div>
            </nav>
          )}
        </CardContent>
      </Card>

      {editing !== undefined && (
        <FacilityFormDialog
          key={editing?.id ?? "new"}
          facility={editing}
          onClose={(saved) => {
            setEditing(undefined);
            if (saved) {
              addToast({ type: "success", title: t("facilities.saved", { name: saved.name }) });
              void reload();
            }
          }}
        />
      )}
      {statusOf && (
        <StatusDialog
          key={statusOf.id}
          facility={statusOf}
          onClose={(changed) => {
            setStatusOf(null);
            if (changed) {
              addToast({ type: "success", title: t("facilities.statusChanged", { name: changed.facility.name, count: changed.sessionsRevoked }) });
              void reload();
            }
          }}
        />
      )}
      {usersOf && <UsersDialog key={usersOf.id} facility={usersOf} canBind={canBind && !usersOf.isSelf} onClose={() => setUsersOf(null)} />}
      <ConfirmDialog
        isOpen={deleting !== null}
        title={t("facilities.deleteTitle")}
        description={
          deleting ? (
            <>
              <span className="block">{t("facilities.deleteBody", { name: deleting.name })}</span>
              {deleteError && (
                <span role="alert" className="mt-2 block text-destructive">
                  {deleteError}
                </span>
              )}
            </>
          ) : undefined
        }
        confirmLabel={t("facilities.deleteConfirm")}
        cancelLabel={t("facilities.cancel")}
        variant="danger"
        isLoading={removing}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
