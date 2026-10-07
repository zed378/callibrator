"use client";

/**
 * P24-06 — the SQL-dump import page's client island: the DPIA banner, the
 * upload (with its progress and the uploader's declaration), the runs (polled
 * while one is in flight) and one run's detail — per-table counts and reasons,
 * the failure in words, cancel and retry. Backend: /api/v1/admin/upstream-sql-imports
 * (super admin only). Every string comes from the `sqlImport.` namespace
 * (Indonesian / English); every count is a count — the server never sends a
 * value from the dump.
 *
 * A non-super-admin who types the URL sees the restriction notice and loads
 * nothing. A 409 shows the backend's state explanation as written.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Alert, Button, Card, CardContent, ErrorState, StatusBadge } from "@/components/ui";
import { DatabaseZap, Shield, X } from "lucide-react";
import { describeApiError } from "@/api/client";
import {
  ACTIVE_SQL_IMPORT_STATUSES,
  upstreamSqlImportService,
  type SqlImportDataClass,
  type SqlImportRun,
  type SqlImportSettings,
} from "@/api/services/upstreamSqlImport.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { deferEffect } from "@/lib/deferEffect";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";

/** How often the page refreshes while an import is in flight. */
export const POLL_MS = 3000;

const isActive = (run: Pick<SqlImportRun, "status">): boolean => ACTIVE_SQL_IMPORT_STATUSES.includes(run.status);

/** The message a failed action shows: a 409's state explanation as the backend wrote it. */
const actionError = (err: unknown): string => describeApiError(err).message || "The action failed";

/** The `?run=<id>` the uploader's notification links to, once. */
const runFromUrl = (): string | null => new URLSearchParams(window.location.search).get("run");

export function UpstreamSqlImportClient({ languageForm }: { languageForm?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role?.name === "SUPERADMIN";
  const addToast = useToastStore((s) => s.addToast);

  const numbers = useMemo(() => new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-GB"), [locale]);
  const dates = useMemo(() => new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium", timeStyle: "short" }), [locale]);
  const n = (value: number): string => numbers.format(value);
  const when = (value: string | null | undefined): string => (value ? dates.format(new Date(value)) : "—");
  const size = (bytes: number): string => (bytes >= 1024 * 1024 ? `${n(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB` : `${n(Math.ceil(bytes / 1024))} KB`);
  const statusLabel = (status: SqlImportRun["status"]): string => t(`sqlImport.status.${status}` as MessageKey);

  const [settings, setSettings] = useState<SqlImportSettings | null>(null);
  const [runs, setRuns] = useState<SqlImportRun[]>([]);
  const [listError, setListError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SqlImportRun | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);

  const [file, setFile] = useState<File | null>(null);
  const [synthetic, setSynthetic] = useState(false);
  const [dataClass, setDataClass] = useState<SqlImportDataClass>("synthetic");
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSuperAdmin) return;
    setListError(null);
    try {
      const [s, page] = await Promise.all([upstreamSqlImportService.settings(), upstreamSqlImportService.list()]);
      setSettings(s);
      setRuns(page.rows);
    } catch (err) {
      setListError(err);
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  const open = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailError(null);
    setActionMessage(null);
    try {
      setDetail(await upstreamSqlImportService.get(id));
    } catch (err) {
      setDetail(null);
      setDetailError(err);
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);

  // The notification's link names a run: open it once.
  useEffect(
    () =>
      deferEffect(() => {
        const linked = isSuperAdmin ? runFromUrl() : null;
        if (linked) void open(linked);
      }),
    [isSuperAdmin, open],
  );

  // While an import is in flight, refresh the list and the open run.
  const inFlight = runs.some(isActive) || (detail !== null && isActive(detail));
  useEffect(() => {
    if (!inFlight) return undefined;
    const timer = setInterval(() => {
      void load();
      if (selectedId) void open(selectedId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, load, open, selectedId]);

  const close = () => {
    setSelectedId(null);
    setDetail(null);
    setActionMessage(null);
  };

  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    setUploadMessage(null);
    const realAllowed = settings?.realDataAllowed === true;
    if (!file) {
      setUploadMessage(t("sqlImport.upload.chooseFile"));
      return;
    }
    if (!realAllowed && !synthetic) {
      setUploadMessage(t("sqlImport.upload.needDeclaration"));
      return;
    }
    if (settings && file.size > settings.maxUploadBytes) {
      setUploadMessage(t("sqlImport.upload.tooLarge", { max: size(settings.maxUploadBytes) }));
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const run = await upstreamSqlImportService.upload(file, realAllowed ? dataClass : "synthetic", setProgress);
      addToast({ type: "success", title: t("sqlImport.upload.done") });
      setFile(null);
      setSynthetic(false);
      await load();
      await open(run.id);
    } catch (err) {
      setUploadMessage(actionError(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const act = async (fn: () => Promise<SqlImportRun>, done: string) => {
    setBusy(true);
    setActionMessage(null);
    try {
      setDetail(await fn());
      addToast({ type: "success", title: done });
      await load();
    } catch (err) {
      // Inline: a 409 is a state explanation, not a generic failure.
      setActionMessage(actionError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center" lang={locale}>
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">{t("sqlImport.restricted.title")}</h1>
          <p className="text-muted-foreground">{t("sqlImport.restricted.body")}</p>
        </div>
      </DashboardLayout>
    );
  }

  const realAllowed = settings?.realDataAllowed === true;

  return (
    <DashboardLayout>
      <div className="space-y-6" lang={locale}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <DatabaseZap className="w-6 h-6 text-primary" aria-hidden="true" />
              {t("sqlImport.title")}
            </h1>
            <p className="text-sm text-muted-foreground max-w-3xl">{t("sqlImport.lead")}</p>
          </div>
          {languageForm}
        </div>

        {settings && (
          <Alert variant={realAllowed ? "info" : "warning"} title={realAllowed ? t("sqlImport.banner.allowedTitle") : t("sqlImport.banner.gatedTitle")}>
            {realAllowed ? t("sqlImport.banner.allowedBody") : t("sqlImport.banner.gatedBody")}
          </Alert>
        )}

        <Card className="border-border">
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-3">{t("sqlImport.upload.heading")}</h2>
            <form className="space-y-4" onSubmit={(e) => void upload(e)} noValidate>
              <div>
                <label htmlFor="sql-dump-file" className="block text-sm font-medium mb-1">
                  {t("sqlImport.upload.file")}
                </label>
                <input
                  id="sql-dump-file"
                  type="file"
                  accept=".sql,.gz,application/sql,application/gzip"
                  aria-describedby="sql-dump-hint"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5"
                />
                <p id="sql-dump-hint" className="mt-1 text-xs text-muted-foreground">
                  {t("sqlImport.upload.hint", { max: settings ? size(settings.maxUploadBytes) : "—" })}
                </p>
              </div>

              {realAllowed ? (
                <fieldset>
                  <legend className="text-sm font-medium mb-1">{t("sqlImport.upload.classLegend")}</legend>
                  {(["synthetic", "real"] as const).map((option) => (
                    <label key={option} className="mr-4 inline-flex items-center gap-2 text-sm">
                      <input type="radio" name="dataClass" value={option} checked={dataClass === option} onChange={() => setDataClass(option)} />
                      {option === "synthetic" ? t("sqlImport.upload.classSynthetic") : t("sqlImport.upload.classReal")}
                    </label>
                  ))}
                </fieldset>
              ) : (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} />
                  {t("sqlImport.upload.declareSynthetic")}
                </label>
              )}

              {progress !== null && (
                <div>
                  <div
                    role="progressbar"
                    aria-label={t("sqlImport.upload.progressLabel")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                    className="h-2 w-full rounded bg-muted overflow-hidden"
                  >
                    <div className="h-full bg-primary" style={{ width: `${String(Math.round(progress * 100))}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t("sqlImport.upload.progress", { percent: Math.round(progress * 100) })}</p>
                </div>
              )}

              <div aria-live="polite">{uploadMessage && <Alert variant="error">{uploadMessage}</Alert>}</div>

              <Button type="submit" isLoading={busy} disabled={busy}>
                {t("sqlImport.upload.submit")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 border-border">
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-1">{t("sqlImport.list.heading")}</h2>
              {inFlight && <p className="text-xs text-muted-foreground mb-2">{t("sqlImport.list.refreshing")}</p>}
              {loading && <p className="text-sm text-muted-foreground">{t("sqlImport.list.loading")}</p>}
              {!loading && listError !== null && <ErrorState error={listError} onRetry={() => void load()} />}
              {!loading && listError === null && runs.length === 0 && <p className="py-8 text-center text-muted-foreground">{t("sqlImport.list.empty")}</p>}
              {!loading && listError === null && runs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th scope="col" className="py-2 pr-3">{t("sqlImport.list.started")}</th>
                        <th scope="col" className="py-2 pr-3">{t("sqlImport.list.status")}</th>
                        <th scope="col" className="py-2 pr-3">{t("sqlImport.list.size")}</th>
                        <th scope="col" className="py-2">{t("sqlImport.list.rows")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => (
                        <tr key={run.id} className={`border-b border-border ${selectedId === run.id ? "bg-muted/50" : ""}`}>
                          <td className="py-2 pr-3">
                            <button
                              type="button"
                              className="font-medium text-primary hover:underline text-left"
                              aria-label={t("sqlImport.list.open", { date: when(run.createdAt) })}
                              onClick={() => void open(run.id)}
                            >
                              {when(run.createdAt)}
                            </button>
                          </td>
                          <td className="py-2 pr-3">
                            <StatusBadge domain="upstreamSqlImport" state={run.status}>
                              {statusLabel(run.status)}
                            </StatusBadge>
                          </td>
                          <td className="py-2 pr-3">{size(run.sizeBytes)}</td>
                          <td className="py-2">{n(run.rowsLoaded)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedId && (
            <Card className="border-border" aria-labelledby="sql-import-detail-title">
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 id="sql-import-detail-title" className="text-lg font-semibold">
                    {t("sqlImport.detail.heading", { id: selectedId.slice(0, 8) })}
                  </h2>
                  <Button variant="ghost" size="sm" onClick={close} aria-label={t("sqlImport.detail.close")}>
                    <X className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
                {detailError !== null && <ErrorState error={detailError} onRetry={() => void open(selectedId)} />}
                {detail && (
                  <>
                    <StatusBadge domain="upstreamSqlImport" state={detail.status}>
                      {statusLabel(detail.status)}
                    </StatusBadge>
                    <div
                      role="progressbar"
                      aria-label={t("sqlImport.detail.progressLabel")}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(detail.progress * 100)}
                      className="h-2 w-full rounded bg-muted overflow-hidden"
                    >
                      <div className="h-full bg-primary" style={{ width: `${String(Math.round(detail.progress * 100))}%` }} />
                    </div>
                    <dl className="grid grid-cols-1 gap-2 text-sm">
                      <div><dt className="text-muted-foreground">{t("sqlImport.detail.rowsLoaded")}</dt><dd>{n(detail.rowsLoaded)}</dd></div>
                      <div><dt className="text-muted-foreground">{t("sqlImport.detail.rowsRejected")}</dt><dd>{n(detail.rowsRejected)}</dd></div>
                      <div><dt className="text-muted-foreground">{t("sqlImport.detail.rowsNotExtracted")}</dt><dd>{n(detail.rowsNotExtracted)}</dd></div>
                      <div><dt className="text-muted-foreground">{t("sqlImport.detail.size")}</dt><dd>{size(detail.sizeBytes)} · {t("sqlImport.detail.compression")}: {detail.compression}</dd></div>
                      <div><dt className="text-muted-foreground">{t("sqlImport.detail.dataClass")}</dt><dd>{detail.dataClass === "real" ? t("sqlImport.upload.classReal") : t("sqlImport.upload.classSynthetic")}</dd></div>
                      <div><dt className="text-muted-foreground">{t("sqlImport.detail.attempt")}</dt><dd>{n(detail.attempt)}</dd></div>
                      {detail.durationMs !== null && (
                        <div><dt className="text-muted-foreground">{t("sqlImport.detail.duration")}</dt><dd>{t("sqlImport.detail.seconds", { seconds: n(Math.round(detail.durationMs / 1000)) })}</dd></div>
                      )}
                      <div><dt className="text-muted-foreground">{t("sqlImport.detail.uploadedBy")}</dt><dd>{detail.uploadedBy?.name ?? "—"}</dd></div>
                      <div><dt className="text-muted-foreground">{t("sqlImport.detail.sha256")}</dt><dd className="font-mono text-xs break-all">{detail.sha256}</dd></div>
                    </dl>

                    {detail.errorCode && (
                      <Alert variant="error" title={detail.errorCode}>
                        {t(`sqlImport.error.${detail.errorCode}` as MessageKey)}
                      </Alert>
                    )}
                    {detail.cancelRequestedAt && isActive(detail) && <Alert variant="info">{t("sqlImport.detail.cancelRequested")}</Alert>}
                    <p className="text-xs text-muted-foreground">
                      {detail.fileRetained && detail.fileRetainUntil
                        ? t("sqlImport.detail.fileKept", { date: when(detail.fileRetainUntil) })
                        : !detail.fileRetained
                          ? t("sqlImport.detail.fileDeleted")
                          : null}
                    </p>
                    {detail.status === "loaded" && <Alert variant="info">{t("sqlImport.detail.transform")}</Alert>}

                    <h3 className="text-sm font-semibold">{t("sqlImport.detail.tables")}</h3>
                    {detail.tables.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("sqlImport.detail.noTables")}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b border-border">
                              <th scope="col" className="py-1 pr-2">{t("sqlImport.detail.table")}</th>
                              <th scope="col" className="py-1 pr-2">{t("sqlImport.detail.loaded")}</th>
                              <th scope="col" className="py-1 pr-2">{t("sqlImport.detail.rejected")}</th>
                              <th scope="col" className="py-1 pr-2">{t("sqlImport.detail.notExtracted")}</th>
                              <th scope="col" className="py-1">{t("sqlImport.detail.reason")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.tables.map((row) => (
                              <tr key={row.table} className="border-b border-border align-top">
                                <th scope="row" className="py-1 pr-2 font-mono font-normal text-left">{row.table}</th>
                                <td className="py-1 pr-2">{n(row.rowsLoaded)}</td>
                                <td className="py-1 pr-2">{n(row.rowsRejected)}</td>
                                <td className="py-1 pr-2">{n(row.rowsNotExtracted)}</td>
                                <td className="py-1 font-mono">
                                  {[row.reason, ...Object.entries(row.rejections).map(([why, count]) => `${why} ${n(count)}`)].filter(Boolean).join(", ") || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div aria-live="polite">{actionMessage && <Alert variant="error">{actionMessage}</Alert>}</div>
                    <div className="flex flex-wrap gap-2">
                      {detail.cancellable && (
                        <Button
                          variant="outline"
                          isLoading={busy}
                          onClick={() => void act(() => upstreamSqlImportService.cancel(detail.id), t("sqlImport.detail.cancelled"))}
                        >
                          {t("sqlImport.detail.cancel")}
                        </Button>
                      )}
                      {detail.retryable && (
                        <Button isLoading={busy} onClick={() => void act(() => upstreamSqlImportService.retry(detail.id), t("sqlImport.detail.retried"))}>
                          {t("sqlImport.detail.retry")}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default UpstreamSqlImportClient;
