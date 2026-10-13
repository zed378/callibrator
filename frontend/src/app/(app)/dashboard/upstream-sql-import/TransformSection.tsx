"use client";

/**
 * C-4 (P26-01 § 9; P24-01, ADR-129 Am. 1 / Am. 3) — stage 2 of a LOADED run on the SQL-dump import
 * page: the transform into a provider tenant's application tables. Until 2026-10-13 the page said
 * stage 2 "is not available yet" although `POST /admin/upstream-sql-imports/:id/transform` exists; the
 * page now offers the action and says what the server says.
 *
 *  - The run's transform state (not requested / requested / transforming / transformed / failed), the
 *    failure's code in words, and the per-step summary (staged, mapped, unchanged, quarantined).
 *  - The provider tenant is chosen from the active tenants (`GET /tenants/all`, super admin); the
 *    transform writes only into the tenant named with the request.
 *  - "Transform into …" sends the request. A refusal is the server's explanation as written: while
 *    the server's transform steps are not all built it answers 409 `TRANSFORM_NOT_AVAILABLE` ("the
 *    run stays staged"), shown as the run's state, not as a generic failure.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, StatusBadge } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { tenantService } from "@/api/services/tenant.service";
import { upstreamSqlImportService, ACTIVE_SQL_TRANSFORM_STATUSES, type SqlImportRun } from "@/api/services/upstreamSqlImport.service";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import { deferEffect } from "@/lib/deferEffect";
import type { Tenant } from "@/types";

interface Props {
  run: SqlImportRun;
  /** The run as the server answered the request (the page re-reads its list). */
  onRequested: (run: SqlImportRun) => void;
}

/** A refusal as the page shows it: a 409 is the run's state, anything else a failure. */
interface Refusal {
  state: boolean;
  message: string;
}

export function TransformSection({ run, onRequested }: Props) {
  const { t, locale } = useI18n();
  const numbers = useMemo(() => new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-GB"), [locale]);
  const n = (value: number): string => numbers.format(value);

  const [find, setFind] = useState("");
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [tenantsFailed, setTenantsFailed] = useState(false);
  const [tenantId, setTenantId] = useState(run.transformTenantId ?? "");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const loadTenants = useCallback(async () => {
    setTenantsFailed(false);
    try {
      const page = await tenantService.getAll(1, 50, find.trim() || undefined);
      setTenants(page.data.filter((x) => x.status === "active"));
    } catch {
      setTenantsFailed(true);
    }
  }, [find]);

  useEffect(() => deferEffect(loadTenants), [loadTenants]);

  const inProgress = ACTIVE_SQL_TRANSFORM_STATUSES.includes(run.transformStatus);
  const chosen = tenants?.find((x) => x.id === tenantId) ?? null;

  const request = async () => {
    if (!tenantId) return;
    setBusy(true);
    setRefusal(null);
    try {
      onRequested(await upstreamSqlImportService.transform(run.id, tenantId));
    } catch (err) {
      const d = describeApiError(err);
      setRefusal({ state: d.status === 409, message: d.message || t("sqlImport.transform.failed") });
    } finally {
      setBusy(false);
    }
  };

  const summary = run.transformSummary;

  return (
    <section aria-labelledby={`transform-${run.id}`} className="space-y-3 rounded-lg border border-border p-3">
      <h3 id={`transform-${run.id}`} className="text-sm font-semibold">
        {t("sqlImport.transform.title")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("sqlImport.detail.transform")}</p>

      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("sqlImport.transform.state")}</span>
        <StatusBadge domain="upstreamSqlTransform" state={run.transformStatus}>
          {t(`sqlImport.transform.status.${run.transformStatus}` as MessageKey)}
        </StatusBadge>
      </p>
      {run.transformErrorCode && (
        <Alert variant="error" title={run.transformErrorCode}>
          {t(`sqlImport.transform.error.${run.transformErrorCode}` as MessageKey)}
        </Alert>
      )}

      {summary && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="text-left text-muted-foreground pb-1">{t("sqlImport.transform.summary")}</caption>
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th scope="col" className="py-1 pr-2">{t("sqlImport.transform.step")}</th>
                <th scope="col" className="py-1 pr-2">{t("sqlImport.detail.table")}</th>
                <th scope="col" className="py-1 pr-2">{t("sqlImport.transform.staged")}</th>
                <th scope="col" className="py-1 pr-2">{t("sqlImport.transform.mapped")}</th>
                <th scope="col" className="py-1 pr-2">{t("sqlImport.transform.unchanged")}</th>
                <th scope="col" className="py-1">{t("sqlImport.transform.quarantined")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.steps.flatMap((step) =>
                step.sources.map((source) => (
                  <tr key={`${step.step}-${source.table}`} className="border-b border-border align-top">
                    <td className="py-1 pr-2 font-mono">{step.step}</td>
                    <th scope="row" className="py-1 pr-2 font-mono font-normal text-left">{source.table}</th>
                    <td className="py-1 pr-2">{n(source.staged)}</td>
                    <td className="py-1 pr-2">{n(source.mapped)}</td>
                    <td className="py-1 pr-2">{n(source.unchanged)}</td>
                    <td className="py-1 font-mono">
                      {Object.entries(source.quarantined)
                        .map(([why, count]) => `${why} ${n(count)}`)
                        .join(", ") || "0"}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {run.status === "loaded" && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={`transform-find-${run.id}`} className="block text-sm font-medium">
                {t("sqlImport.transform.find")}
              </label>
              <input
                id={`transform-find-${run.id}`}
                type="search"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor={`transform-tenant-${run.id}`} className="block text-sm font-medium">
                {t("sqlImport.transform.tenant")}
              </label>
              <select
                id={`transform-tenant-${run.id}`}
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                disabled={inProgress}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">{t("sqlImport.transform.chooseTenant")}</option>
                {(tenants ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
          {tenantsFailed && (
            <Alert variant="error" title={t("sqlImport.transform.tenantsFailed")}>
              <Button size="sm" variant="outline" onClick={() => void loadTenants()}>
                {t("sqlImport.transform.retry")}
              </Button>
            </Alert>
          )}
          {tenants !== null && tenants.length === 0 && !tenantsFailed && <p className="text-sm text-muted-foreground">{t("sqlImport.transform.noTenants")}</p>}

          <div aria-live="polite">
            {refusal &&
              (refusal.state ? (
                <Alert variant="info" title={t("sqlImport.transform.notStarted")}>
                  {refusal.message}
                </Alert>
              ) : (
                <Alert variant="error" title={t("sqlImport.transform.failed")}>
                  {refusal.message}
                </Alert>
              ))}
          </div>
          <Button isLoading={busy} disabled={busy || inProgress || !tenantId} onClick={() => void request()}>
            {chosen ? t("sqlImport.transform.requestInto", { name: chosen.name }) : t("sqlImport.transform.request")}
          </Button>
        </div>
      )}
    </section>
  );
}
