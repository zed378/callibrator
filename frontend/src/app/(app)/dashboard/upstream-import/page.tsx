// src/app/dashboard/upstream-import/page.tsx
"use client";

/**
 * The rsync image import (super admin only): a source form, "check connection" with the
 * server's host-key fingerprint to confirm (trust on first use, confirmed by a person), an
 * estimate per file class, start, and the list of imports with progress, details and cancel.
 * Backend: /api/v1/admin/upstream-file-imports (upstreamFileImports.route.ts).
 *
 * The password or private key lives only in this form's state: it is sent with "check" and
 * "start" and cleared once the import is queued; no answer ever carries it back, so it can never
 * be shown again. A 409 shows the backend's state explanation. Bilingual (ID/EN): see messages.ts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Alert, Button, Card, CardContent, ConfirmDialog, ErrorState, Input, Select, StatusBadge, Textarea } from "@/components/ui";
import { KeyRound, Shield, UploadCloud } from "lucide-react";
import { describeApiError } from "@/api/client";
import {
  LIVE_STATUSES,
  upstreamImportService,
  type CheckInput,
  type ConnectionCheck,
  type ImportConfig,
  type UpstreamImport,
} from "@/api/services/upstreamImport.service";
import { tenantService } from "@/api/services/tenant.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { deferEffect } from "@/lib/deferEffect";
import { MESSAGES, initialLocale, type PageLocale } from "./messages";

const POLL_MS = 5000;

type FileClass = "front" | "serial";

interface FormState {
  host: string;
  port: string;
  username: string;
  authMethod: "key" | "password";
  password: string;
  privateKey: string;
  remotePath: string;
  front: boolean;
  serial: boolean;
  syntheticSource: boolean;
  targetTenantId: string;
  bandwidthLimitKbps: string;
}

const EMPTY: FormState = {
  host: "",
  port: "22",
  username: "",
  authMethod: "key",
  password: "",
  privateKey: "",
  remotePath: "",
  front: true,
  serial: true,
  syntheticSource: false,
  targetTenantId: "",
  bandwidthLimitKbps: "",
};

/** Bytes as people read them. */
export const formatBytes = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(value) : value.toFixed(1)} ${units[unit]}`;
};

const fmtDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "—");

/** The source part of the form as the API takes it (what "check" sends). */
const sourceOf = (form: FormState, confirmedFingerprint?: string): CheckInput => ({
  host: form.host.trim(),
  port: Number(form.port) || 22,
  username: form.username.trim(),
  authMethod: form.authMethod,
  ...(form.authMethod === "password" ? { password: form.password } : { privateKey: form.privateKey }),
  remotePath: form.remotePath.trim(),
  fileClasses: (["front", "serial"] as FileClass[]).filter((c) => form[c]),
  syntheticSource: form.syntheticSource,
  ...(confirmedFingerprint ? { confirmedFingerprint } : {}),
});

/** A key over the source fields: a check answers for exactly these values, nothing else. */
const sourceKey = (form: FormState): string =>
  JSON.stringify([form.host, form.port, form.username, form.authMethod, form.password, form.privateKey, form.remotePath, form.front, form.serial, form.syntheticSource]);

export default function UpstreamImportPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role?.name === "SUPERADMIN";
  const addToast = useToastStore((s) => s.addToast);

  const [locale, setLocale] = useState<PageLocale>(() => (typeof document === "undefined" ? "en" : initialLocale(document.cookie)));
  const t = MESSAGES[locale];

  const [config, setConfig] = useState<ImportConfig | null>(null);
  const [tenants, setTenants] = useState<{ value: string; label: string }[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [chosenFingerprint, setChosenFingerprint] = useState("");
  const [busy, setBusy] = useState<"check" | "confirm" | "start" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [imports, setImports] = useState<UpstreamImport[]>([]);
  const [listError, setListError] = useState<unknown>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const loadImports = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      setImports((await upstreamImportService.list()).rows);
      setListError(null);
    } catch (err) {
      setListError(err);
    }
  }, [isSuperAdmin]);

  const loadSetup = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      const [cfg, page] = await Promise.all([upstreamImportService.config(), tenantService.getAll(1, 100)]);
      setConfig(cfg);
      setTenants(page.data.map((tn) => ({ value: tn.id, label: tn.name })));
    } catch (err) {
      setListError(err);
    }
  }, [isSuperAdmin]);

  useEffect(() => deferEffect(loadSetup), [loadSetup]);
  useEffect(() => deferEffect(loadImports), [loadImports]);
  // The notification links here with ?import=<id>: open that import's details.
  useEffect(
    () =>
      deferEffect(() => {
        const wanted = new URLSearchParams(window.location.search).get("import");
        if (wanted) setOpenId(wanted);
      }),
    [],
  );

  // Poll while an import can still change.
  const loadRef = useRef(loadImports);
  useEffect(() => {
    loadRef.current = loadImports;
  }, [loadImports]);
  const anyLive = imports.some((i) => LIVE_STATUSES.includes(i.status));
  useEffect(() => {
    if (!anyLive) return undefined;
    const timer = setInterval(() => void loadRef.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [anyLive]);

  const key = sourceKey(form);
  const currentCheck = checkedFor === key ? check : null;
  const canStart =
    currentCheck?.status === "ok" && Boolean(currentCheck.confirmedHostKey) && form.targetTenantId !== "" && busy === null;

  const runCheck = async (fingerprint?: string) => {
    setBusy(fingerprint ? "confirm" : "check");
    setActionError(null);
    try {
      const answer = await upstreamImportService.check(sourceOf(form, fingerprint));
      setCheck(answer);
      setCheckedFor(key);
      if (!fingerprint) setChosenFingerprint(answer.hostKeys[0]?.fingerprint ?? "");
    } catch (err) {
      setActionError(describeApiError(err).message || t.loadError);
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    const fingerprint = currentCheck?.confirmedHostKey?.fingerprint;
    if (!fingerprint) return;
    setBusy("start");
    setActionError(null);
    try {
      const limit = Number(form.bandwidthLimitKbps);
      await upstreamImportService.start({
        ...sourceOf(form, fingerprint),
        confirmedFingerprint: fingerprint,
        targetTenantId: form.targetTenantId,
        bandwidthLimitKbps: Number.isInteger(limit) && limit > 0 ? limit : null,
      });
      // The credential is never shown again: it leaves this page's state now.
      setForm((f) => ({ ...f, password: "", privateKey: "" }));
      setCheck(null);
      setCheckedFor(null);
      addToast({ type: "success", title: t.started });
      await loadImports();
    } catch (err) {
      setActionError(describeApiError(err).message || t.loadError);
    } finally {
      setBusy(null);
    }
  };

  const confirmCancel = async () => {
    const id = cancelId;
    setCancelId(null);
    if (!id) return;
    try {
      await upstreamImportService.cancel(id);
      await loadImports();
    } catch (err) {
      setActionError(describeApiError(err).message || t.loadError);
    }
  };

  const percentOf = (imp: UpstreamImport): number | null => {
    const p = imp.progress;
    if (!p || imp.status === "pending") return null;
    if (imp.status === "completed") return 100;
    const estimateBytes = imp.estimate?.bytes ?? 0;
    const transfer = estimateBytes > 0 ? Math.min(1, p.bytesTransferred / estimateBytes) : 0;
    const ingest = p.filesToProcess > 0 ? p.filesProcessed / p.filesToProcess : 0;
    return Math.min(99, Math.floor(transfer * 50 + ingest * 50));
  };

  const languageSwitch = useMemo(
    () => (
      <div role="group" aria-label={t.language} className="flex gap-1">
        {(["id", "en"] as PageLocale[]).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={locale === l}
            onClick={() => setLocale(l)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
              locale === l ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground"
            }`}
          >
            {l === "id" ? "ID" : "EN"}
          </button>
        ))}
      </div>
    ),
    [locale, t.language],
  );

  if (!isSuperAdmin) {
    return (
      <DashboardLayout>
        <div lang={locale} className="max-w-xl mx-auto py-20 text-center">
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">{t.title}</h1>
          <p className="text-muted-foreground">{t.restricted}</p>
        </div>
      </DashboardLayout>
    );
  }

  const open = imports.find((i) => i.id === openId) ?? null;

  return (
    <DashboardLayout>
      <div lang={locale} className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
            <p className="text-sm text-muted-foreground max-w-3xl">{t.intro}</p>
          </div>
          {languageSwitch}
        </div>

        {config && !config.realDataAllowed && (
          <Alert variant="warning" title={t.gateClosedTitle}>
            {t.gateClosed}
          </Alert>
        )}
        {config?.realDataAllowed && <Alert variant="info">{t.gateOpen}</Alert>}

        <Card className="border-border">
          <CardContent className="pt-6">
            <form
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void runCheck();
              }}
            >
              <h2 className="md:col-span-2 text-lg font-semibold">{t.sourceSection}</h2>
              <Input label={t.host} value={form.host} onChange={(e) => set("host", e.target.value)} autoComplete="off" required />
              <Input label={t.port} type="number" min={1} max={65535} value={form.port} onChange={(e) => set("port", e.target.value)} />
              <Input label={t.username} value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" required />
              <fieldset className="space-y-2">
                <legend className="block text-sm font-medium mb-2 text-foreground">{t.authMethod}</legend>
                {(["key", "password"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="authMethod" checked={form.authMethod === m} onChange={() => set("authMethod", m)} />
                    {m === "key" ? t.authKey : t.authPassword}
                  </label>
                ))}
              </fieldset>
              {form.authMethod === "password" ? (
                <Input
                  label={t.password}
                  type="password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  autoComplete="new-password"
                  helperText={t.credentialNote}
                  className="md:col-span-2"
                />
              ) : (
                <div className="md:col-span-2">
                  <Textarea
                    label={t.privateKey}
                    value={form.privateKey}
                    onChange={(e) => set("privateKey", e.target.value)}
                    rows={4}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{t.credentialNote}</p>
                </div>
              )}
              <div className="md:col-span-2">
                <Input label={t.remotePath} value={form.remotePath} onChange={(e) => set("remotePath", e.target.value)} helperText={t.remotePathHelp} autoComplete="off" required />
              </div>
              <fieldset className="space-y-2">
                <legend className="block text-sm font-medium mb-2 text-foreground">{t.classes}</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.front} onChange={(e) => set("front", e.target.checked)} />
                  {t.classFront}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.serial} onChange={(e) => set("serial", e.target.checked)} />
                  {t.classSerial}
                </label>
                <p className="text-xs text-muted-foreground">{t.heicNote}</p>
              </fieldset>
              <label className="flex items-center gap-2 text-sm self-start mt-7">
                <input type="checkbox" checked={form.syntheticSource} onChange={(e) => set("syntheticSource", e.target.checked)} />
                {t.synthetic}
              </label>

              <h2 className="md:col-span-2 text-lg font-semibold mt-2">{t.targetSection}</h2>
              <div>
                <span id="upstream-tenant-label" className="block text-sm font-medium mb-2 text-foreground">
                  {t.tenant}
                </span>
                <Select
                  value={form.targetTenantId}
                  onChange={(v) => set("targetTenantId", v)}
                  options={tenants}
                  placeholder={t.tenantPlaceholder}
                  aria-label={t.tenant}
                />
              </div>
              <Input
                label={t.bandwidth}
                type="number"
                min={64}
                value={form.bandwidthLimitKbps}
                onChange={(e) => set("bandwidthLimitKbps", e.target.value)}
              />

              <div className="md:col-span-2 flex flex-wrap gap-3">
                <Button type="submit" variant="outline" isLoading={busy === "check"} disabled={busy !== null}>
                  <KeyRound className="w-4 h-4 mr-2" aria-hidden="true" />
                  {busy === "check" ? t.checking : t.checkButton}
                </Button>
                <Button type="button" onClick={() => void start()} disabled={!canStart} isLoading={busy === "start"}>
                  <UploadCloud className="w-4 h-4 mr-2" aria-hidden="true" />
                  {busy === "start" ? t.starting : t.startButton}
                </Button>
              </div>
            </form>

            {actionError && (
              <div className="mt-4">
                <Alert variant="error">{actionError}</Alert>
              </div>
            )}

            {currentCheck && (
              <section className="mt-6 space-y-3" aria-live="polite">
                <p className="text-sm font-medium">
                  {t.outcome[currentCheck.status as keyof typeof t.outcome] ?? currentCheck.status}
                </p>
                {currentCheck.hostKeys.length > 0 && (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold">{t.hostKeysTitle}</legend>
                    <p className="text-xs text-muted-foreground">{t.hostKeysHelp}</p>
                    {currentCheck.hostKeys.map((k) => (
                      <label key={k.fingerprint} className="flex items-center gap-2 text-sm font-mono break-all">
                        <input
                          type="radio"
                          name="fingerprint"
                          checked={chosenFingerprint === k.fingerprint}
                          onChange={() => setChosenFingerprint(k.fingerprint)}
                        />
                        <span>
                          {k.type} {k.fingerprint}
                        </span>
                      </label>
                    ))}
                    {!currentCheck.confirmedHostKey && (
                      <Button type="button" variant="secondary" onClick={() => void runCheck(chosenFingerprint)} disabled={!chosenFingerprint || busy !== null} isLoading={busy === "confirm"}>
                        {t.confirmKey}
                      </Button>
                    )}
                  </fieldset>
                )}
                {currentCheck.estimate && (
                  <div>
                    <h3 className="text-sm font-semibold">{t.estimateTitle}</h3>
                    <ul className="text-sm list-disc ml-5">
                      {(Object.entries(currentCheck.classes) as [FileClass, NonNullable<ConnectionCheck["classes"][FileClass]>][]).map(([cls, c]) => (
                        <li key={cls}>
                          {cls === "front" ? t.classFront : t.classSerial}:{" "}
                          {c.status === "ok"
                            ? `${c.files.toLocaleString()} ${t.files}, ${formatBytes(c.bytes)}`
                            : c.status === "path_not_found"
                              ? t.folderMissing
                              : t.folderUnreadable}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-3">{t.jobsTitle}</h2>
            {listError !== null && <ErrorState error={listError} onRetry={() => void loadImports()} />}
            {listError === null && imports.length === 0 && <p className="text-sm text-muted-foreground">{t.noJobs}</p>}
            {imports.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th scope="col" className="py-2 pr-3">{t.colCreated}</th>
                      <th scope="col" className="py-2 pr-3">{t.colSource}</th>
                      <th scope="col" className="py-2 pr-3">{t.colStatus}</th>
                      <th scope="col" className="py-2 pr-3">{t.colProgress}</th>
                      <th scope="col" className="py-2">{t.colActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map((imp) => {
                      const percent = percentOf(imp);
                      return (
                        <tr key={imp.id} className="border-b border-border align-top">
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(imp.createdAt)}</td>
                          <td className="py-2 pr-3">
                            <span className="font-mono">{imp.username}@{imp.host}:{imp.port}</span>
                            <span className="block text-muted-foreground break-all">{imp.remotePath}</span>
                          </td>
                          <td className="py-2 pr-3">
                            <StatusBadge domain="upstreamImport" state={imp.status}>
                              {t.status[imp.status]}
                            </StatusBadge>
                          </td>
                          <td className="py-2 pr-3 min-w-[8rem]">
                            {percent === null ? (
                              "—"
                            ) : (
                              <progress className="w-full" max={100} value={percent} aria-label={`${t.colProgress} ${String(percent)}%`}>
                                {percent}%
                              </progress>
                            )}
                          </td>
                          <td className="py-2 whitespace-nowrap space-x-2">
                            <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === imp.id ? null : imp.id)} aria-expanded={openId === imp.id}>
                              {openId === imp.id ? t.hide : t.details}
                            </Button>
                            {LIVE_STATUSES.includes(imp.status) && !imp.cancelRequested && (
                              <Button size="sm" variant="danger" onClick={() => setCancelId(imp.id)}>
                                {t.cancel}
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

            {open && (
              <section className="mt-4 rounded-xl border border-border p-4 text-sm space-y-2" aria-label={t.summary}>
                <h3 className="font-semibold">{t.summary}</h3>
                {open.summary ? (
                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">{t.copied}</dt>
                    <dd>{open.summary.filesCopied.toLocaleString()} ({formatBytes(open.summary.bytesCopied)})</dd>
                    <dt className="text-muted-foreground">{t.ingested}</dt>
                    <dd>{open.summary.ingested.toLocaleString()} ({formatBytes(open.summary.bytesIngested)})</dd>
                    <dt className="text-muted-foreground">{t.skipped}</dt>
                    <dd>{open.summary.skippedPresent.toLocaleString()}</dd>
                    <dt className="text-muted-foreground">{t.quarantined}</dt>
                    <dd>
                      {open.summary.quarantined.toLocaleString()}
                      {Object.entries(open.summary.quarantinedByReason).map(([reason, n]) => (
                        <span key={reason} className="block text-xs text-muted-foreground">
                          {reason}: {n}
                        </span>
                      ))}
                    </dd>
                    <dt className="text-muted-foreground">{t.failed}</dt>
                    <dd>{open.summary.failed.toLocaleString()}</dd>
                    <dt className="text-muted-foreground">{t.stripped}</dt>
                    <dd>{open.summary.metadataStripped.toLocaleString()}</dd>
                    <dt className="text-muted-foreground">{t.duplicates}</dt>
                    <dd>{open.summary.duplicateContent.toLocaleString()}</dd>
                    <dt className="text-muted-foreground">{t.duration}</dt>
                    <dd>{Math.round(open.summary.durationMs / 1000)} s</dd>
                  </dl>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
                {open.errorCode && (
                  <p>
                    <span className="text-muted-foreground">{t.reason}:</span>{" "}
                    {t.outcome[open.errorCode as keyof typeof t.outcome] ?? open.errorCode}
                  </p>
                )}
                {open.secretErasedAt && (
                  <p className="text-muted-foreground">
                    {t.credentialErased}: {fmtDate(open.secretErasedAt)}
                  </p>
                )}
              </section>
            )}
          </CardContent>
        </Card>

        <ConfirmDialog
          isOpen={cancelId !== null}
          title={t.cancel}
          description={t.cancelConfirm}
          confirmLabel={t.cancelYes}
          cancelLabel={t.keepRunning}
          variant="danger"
          onConfirm={() => void confirmCancel()}
          onCancel={() => setCancelId(null)}
        />
      </div>
    </DashboardLayout>
  );
}
