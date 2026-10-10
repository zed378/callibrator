"use client";

/**
 * P22-02 — the device register (/dashboard/devices; F-23 … F-31; P19-03 spec § 4 – § 8 as built by
 * P21-02a / P21-02b).
 *
 * What a caller sees is decided by the SAME effective permissions the API gates read (ADR-102;
 * never a role name):
 *  - the list: `calibration` read. A facility-BOUND reader reads its own facility's devices (the
 *    server scopes them): no facility column or filter, no IoT, no CSV import, no delete (those
 *    routes refuse it, 403 FACILITY_ROUTE_REFUSED);
 *  - register / edit: `calibration` write — a bound technician's form has no QR, status,
 *    laboratory, store or facility field (its contract is strict);
 *  - photos: managed with `calibration` write, never by the platform operator (the platform tenant
 *    authors nothing, A-127); every reader can look at them;
 *  - the laboratory picker: `vendors` read.
 *
 * Loading, empty and failed are three states; a failed read is never an empty register. Bilingual
 * (Indonesian default, English): every string is the `devices.` namespace the server page hands
 * this island.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { HardDrive, Plus, Search, Shield, Upload } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Alert, Button, Card, CardContent, ConfirmDialog, ErrorState } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { clientFacilityService, type ClientFacilityOption } from "@/api/services/clientFacility.service";
import { deviceRegisterService, type DeviceListQuery, type ImportReport, type RegisterDevice } from "@/api/services/deviceRegister.service";
import { usePermissions, type Permissions } from "@/hooks/usePermissions";
import { usePaged } from "@/hooks/usePaged";
import { deferEffect } from "@/lib/deferEffect";
import { useSearchHandoff } from "@/stores/searchHandoffStore";
import { useToastStore } from "@/stores/toastStore";
import { useI18n } from "@/i18n/MessagesProvider";
import IotDeviceModal from "./components/IotDeviceModal";
import { DeviceFormDialog } from "./components/DeviceFormDialog";
import { DeviceTable, type RowActions } from "./components/DeviceTable";
import { PhotosDialog } from "./components/PhotosDialog";
import { TypePicker } from "./components/TypePicker";
import { FIELD, Field, Pager, useDeviceText } from "./components/shared";

export const PAGE_SIZE = 20;

export interface Filters {
  find: string;
  qrCode: string;
  deviceTypeId: string;
  deviceTypeName: string;
  condition: "" | "good" | "not_good" | "broken";
  status: "" | "active" | "inactive" | "maintenance" | "retired";
  calibrationDue: "" | "overdue" | "due_soon" | "requested";
  clientFacilityId: string;
  category: string;
}

export const INITIAL_FILTERS: Filters = {
  find: "",
  qrCode: "",
  deviceTypeId: "",
  deviceTypeName: "",
  condition: "",
  status: "",
  calibrationDue: "",
  clientFacilityId: "",
  category: "",
};

/** The list's query for a page: only what is set is sent. */
export const listQuery = (f: Filters, page: number): DeviceListQuery => ({
  page,
  limit: PAGE_SIZE,
  ...(f.find.trim() ? { find: f.find.trim() } : {}),
  ...(f.qrCode.trim() ? { qrCode: f.qrCode.trim() } : {}),
  ...(f.deviceTypeId ? { deviceTypeId: f.deviceTypeId } : {}),
  ...(f.condition ? { condition: f.condition } : {}),
  ...(f.status ? { status: f.status } : {}),
  ...(f.calibrationDue ? { calibrationDue: f.calibrationDue } : {}),
  ...(f.clientFacilityId ? { clientFacilityId: f.clientFacilityId } : {}),
  ...(f.category.trim() ? { category: f.category.trim() } : {}),
});

type Can = Pick<Permissions, "superAdmin" | "facilityBound" | "canRead" | "canWrite">;

/** What the caller may do on this page. */
export const accessFor = (p: Can) => {
  const write = p.canWrite("calibration");
  return {
    read: p.canRead("calibration"),
    write,
    importCsv: write && !p.facilityBound,
    photosWrite: write && !p.superAdmin,
    rows: { photos: true, edit: write, remove: write && !p.facilityBound, iot: !p.facilityBound } satisfies RowActions,
  };
};

const rowErrorText = (errors: ImportReport["errors"][number]["errors"]): string =>
  typeof errors === "string" ? errors : errors.map((e) => `${e.field}: ${e.message}`).join("; ");

export function DevicesClient({ languageForm }: { languageForm?: React.ReactNode }) {
  const { locale } = useI18n();
  const text = useDeviceText();
  const { t } = text;
  const permissions = usePermissions();
  const access = accessFor(permissions);
  const bound = permissions.facilityBound;

  if (!permissions.loaded) {
    return (
      <DashboardLayout>
        <div lang={locale}>
          <h1 className="sr-only">{t("devices.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("devices.loading")}</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!access.read) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center" lang={locale}>
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">{t("devices.title")}</h1>
          <p className="text-muted-foreground">{t("devices.restricted")}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div lang={locale}>
        <Register access={access} bound={bound} canPickLab={!bound && permissions.canRead("vendors")} languageForm={languageForm} />
      </div>
    </DashboardLayout>
  );
}

interface RegisterProps {
  access: ReturnType<typeof accessFor>;
  bound: boolean;
  canPickLab: boolean;
  languageForm?: React.ReactNode;
}

function Register({ access, bound, canPickLab, languageForm }: RegisterProps) {
  const text = useDeviceText();
  const { t } = text;
  const addToast = useToastStore((s) => s.addToast);
  const handed = useSearchHandoff("device");
  const [filters, setFilters] = useState<Filters>(() => ({ ...INITIAL_FILTERS, find: handed ?? "" }));
  const [facilities, setFacilities] = useState<ClientFacilityOption[]>([]);
  const [editing, setEditing] = useState<RegisterDevice | null | undefined>(undefined);
  const [photos, setPhotos] = useState<{ device: RegisterDevice; mode: "register" | "manage" } | null>(null);
  const [deleting, setDeleting] = useState<RegisterDevice | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [iot, setIot] = useState<RegisterDevice | null>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const fetchPage = useCallback((page: number) => deviceRegisterService.list(listQuery(filters, page)), [filters]);
  const list = usePaged(fetchPage);
  const { setPage, reload } = list;

  // The facility filter's options (provider staff only): a convenience, not a boundary. A failed read
  // leaves the filter out; the list still reads every facility the caller may see.
  useEffect(() => {
    if (bound) return undefined;
    return deferEffect(async () => {
      try {
        setFacilities(await clientFacilityService.options());
      } catch {
        setFacilities([]);
      }
    });
  }, [bound]);

  const change = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const onSaved = (device: RegisterDevice, created: boolean) => {
    setEditing(undefined);
    addToast({ type: "success", title: created ? t("devices.form.created", { name: device.name }) : t("devices.form.saved", { name: device.name }) });
    if (created && access.photosWrite) setPhotos({ device, mode: "register" });
    void reload();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setRemoving(true);
    setDeleteError(null);
    try {
      await deviceRegisterService.remove(deleting.id);
      addToast({ type: "success", title: t("devices.delete.done", { name: deleting.name }) });
      setDeleting(null);
      void reload();
    } catch (err) {
      setDeleteError(describeApiError(err).message || t("devices.delete.failed"));
    } finally {
      setRemoving(false);
    }
  };

  const importFile = async (file: File) => {
    setImporting(true);
    setReport(null);
    setImportError(null);
    try {
      setReport(await deviceRegisterService.bulkImport(file));
      void reload();
    } catch (err) {
      setImportError(describeApiError(err).message || t("devices.import.failed"));
    } finally {
      setImporting(false);
    }
  };

  const showFacility = !bound;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <HardDrive className="w-6 h-6 text-primary" aria-hidden="true" />
            {t("devices.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{bound ? t("devices.leadBound") : t("devices.lead")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {languageForm}
          {access.importCsv && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                tabIndex={-1}
                aria-label={t("devices.import.file")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void importFile(file);
                }}
              />
              <Button
                variant="outline"
                isLoading={importing}
                leftIcon={<Upload className="h-4 w-4" aria-hidden="true" />}
                onClick={() => fileInput.current?.click()}
              >
                {t("devices.import.button")}
              </Button>
            </>
          )}
          {access.write && (
            <Button leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing(null)}>
              {t("devices.add")}
            </Button>
          )}
        </div>
      </div>

      {importError && (
        <div role="alert">
          <Alert variant="error" title={t("devices.import.refusedTitle")}>
            <p>{importError}</p>
          </Alert>
        </div>
      )}
      {report && (
        <div role="status">
          <Alert variant={report.failedCount > 0 ? "warning" : "success"} title={t("devices.import.doneTitle")}>
            <p>{t("devices.import.summary", { done: report.successCount, total: report.totalCount, failed: report.failedCount })}</p>
            {report.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {report.errors.slice(0, 5).map((err) => (
                  <li key={err.row}>{t("devices.import.row", { row: err.row, errors: rowErrorText(err.errors) })}</li>
                ))}
                {report.errors.length > 5 && <li>{t("devices.import.more", { count: report.errors.length - 5 })}</li>}
              </ul>
            )}
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setReport(null)}>
              {t("devices.dismiss")}
            </Button>
          </Alert>
        </div>
      )}

      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{t("devices.filters.heading")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="filter-find" label={t("devices.filters.find")}>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input id="filter-find" type="search" className={`${FIELD} pl-9`} value={filters.find} maxLength={100} onChange={(e) => change({ find: e.target.value })} />
              </div>
            </Field>
            <Field id="filter-qr" label={t("devices.filters.qr")}>
              <input id="filter-qr" className={`${FIELD} font-mono uppercase`} value={filters.qrCode} maxLength={64} onChange={(e) => change({ qrCode: e.target.value })} />
            </Field>
            <Field id="filter-condition" label={t("devices.filters.condition")}>
              <select id="filter-condition" className={FIELD} value={filters.condition} onChange={(e) => change({ condition: e.target.value as Filters["condition"] })}>
                <option value="">{t("devices.filters.all")}</option>
                <option value="good">{text.condition("good")}</option>
                <option value="not_good">{text.condition("not_good")}</option>
                <option value="broken">{text.condition("broken")}</option>
              </select>
            </Field>
            <Field id="filter-status" label={t("devices.filters.status")}>
              <select id="filter-status" className={FIELD} value={filters.status} onChange={(e) => change({ status: e.target.value as Filters["status"] })}>
                <option value="">{t("devices.filters.all")}</option>
                {(["active", "inactive", "maintenance", "retired"] as const).map((s) => (
                  <option key={s} value={s}>
                    {text.status(s)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="filter-due" label={t("devices.filters.due")}>
              <select id="filter-due" className={FIELD} value={filters.calibrationDue} onChange={(e) => change({ calibrationDue: e.target.value as Filters["calibrationDue"] })}>
                <option value="">{t("devices.filters.all")}</option>
                {(["overdue", "due_soon", "requested"] as const).map((s) => (
                  <option key={s} value={s}>
                    {text.due(s)}
                  </option>
                ))}
              </select>
            </Field>
            {showFacility && facilities.length > 0 && (
              <Field id="filter-facility" label={t("devices.filters.facility")}>
                <select id="filter-facility" className={FIELD} value={filters.clientFacilityId} onChange={(e) => change({ clientFacilityId: e.target.value })}>
                  <option value="">{t("devices.filters.allFacilities")}</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field id="filter-category" label={t("devices.filters.category")}>
              <input id="filter-category" className={FIELD} value={filters.category} maxLength={100} onChange={(e) => change({ category: e.target.value })} />
            </Field>
          </div>
          <TypePicker
            id="filter-type"
            label={t("devices.filters.type")}
            value={filters.deviceTypeId}
            valueName={filters.deviceTypeName}
            noneLabel={t("devices.filters.allTypes")}
            onChange={(deviceTypeId, deviceTypeName) => change({ deviceTypeId, deviceTypeName })}
          />
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardContent className="p-0">
          {list.loading && <p className="p-6 text-sm text-muted-foreground">{t("devices.loading")}</p>}
          {!list.loading && list.error !== null && (
            <div className="p-6">
              <ErrorState error={list.error} onRetry={() => void reload()} />
            </div>
          )}
          {!list.loading && list.error === null && list.rows.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-base font-medium">{t("devices.list.empty")}</p>
              <p className="text-sm">{t("devices.list.emptyHint")}</p>
            </div>
          )}
          {!list.loading && list.error === null && list.rows.length > 0 && (
            <DeviceTable
              rows={list.rows}
              showFacility={showFacility}
              actions={access.rows}
              onPhotos={(device) => setPhotos({ device, mode: "manage" })}
              onEdit={(device) => setEditing(device)}
              onDelete={(device) => {
                setDeleteError(null);
                setDeleting(device);
              }}
              onIot={setIot}
            />
          )}
          <Pager meta={list.meta} onPage={setPage} label={t("devices.list.caption")} />
        </CardContent>
      </Card>

      {editing !== undefined && (
        <DeviceFormDialog
          key={editing?.id ?? "new"}
          device={editing}
          bound={bound}
          canPickLab={canPickLab}
          onClose={() => setEditing(undefined)}
          onSaved={onSaved}
        />
      )}

      {photos && (
        <PhotosDialog
          key={photos.device.id}
          device={photos.device}
          mode={photos.mode}
          canWrite={access.photosWrite}
          onClose={(changed) => {
            setPhotos(null);
            if (changed) void reload();
          }}
        />
      )}

      {iot && <IotDeviceModal key={iot.id} device={iot} onClose={() => setIot(null)} hasWriteAccess={access.write} />}

      <ConfirmDialog
        isOpen={deleting !== null}
        title={t("devices.delete.title")}
        description={
          deleting ? (
            <>
              <span className="block">{t("devices.delete.body", { name: deleting.name })}</span>
              {deleteError && (
                <span role="alert" className="mt-2 block text-destructive">
                  {deleteError}
                </span>
              )}
            </>
          ) : undefined
        }
        confirmLabel={t("devices.delete.confirm")}
        cancelLabel={t("devices.cancel")}
        variant="danger"
        isLoading={removing}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
