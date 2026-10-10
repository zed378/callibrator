"use client";

/**
 * P22-03 (F-35, F-36) — start an IPM: the device by its QR sticker (typed, a handheld scanner, or
 * the camera), its facts read in the caller's context (a bound technician finds only its
 * facility's devices — another's is the "not found" of a missing one), then `POST /ipm/sessions`:
 * the server resolves the checklist and answers the PREFILLED draft (no prefill route), and the
 * capture opens. The draft's `clientRef` is made once per device chosen, so a retried start answers
 * the same draft (AM-16). Every refusal is the server's explanation; a draft the technician already
 * has for the device is offered to resume (409 `IPM_DRAFT_EXISTS`, top-level `draftId`).
 *
 * Who may start: `ipm` write, never the platform operator (ADR-052).
 */
import React, { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Camera, ClipboardCheck, Search, Shield } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Alert, Button, Card, CardContent } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { calibrationDatesService } from "@/api/services/calibrationDates.service";
import { ipmHistoryService } from "@/api/services/ipmHistory.service";
import type { RegisterDevice } from "@/api/services/deviceRegister.service";
import { usePermissions } from "@/hooks/usePermissions";
import { useI18n } from "@/i18n/MessagesProvider";
import { QrScanner, canScan } from "../components/QrScanner";
import { FIELD, useIpmText } from "../components/shared";

/** The draft a 409 `IPM_DRAFT_EXISTS` names (top-level `draftId`), else null. */
export const draftIdOf = (err: unknown): string | null => {
  if (!axios.isAxiosError(err)) return null;
  const data: unknown = err.response?.data;
  if (typeof data !== "object" || data === null) return null;
  const id = (data as { draftId?: unknown }).draftId;
  return typeof id === "string" ? id : null;
};

const noSubscription = (): (() => void) => () => undefined;

/** A fresh capture reference (uuid v4). */
export const newClientRef = (): string => crypto.randomUUID();

export function StartClient({ languageForm }: { languageForm?: React.ReactNode }) {
  const { locale } = useI18n();
  const { t } = useIpmText();
  const permissions = usePermissions();

  if (!permissions.loaded) {
    return (
      <DashboardLayout>
        <div lang={locale}>
          <h1 className="sr-only">{t("ipm.start.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("ipm.loading")}</p>
        </div>
      </DashboardLayout>
    );
  }
  if (!permissions.canWrite("ipm") || permissions.superAdmin) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center" lang={locale}>
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">{t("ipm.start.title")}</h1>
          <p className="text-muted-foreground">{t("ipm.start.restricted")}</p>
        </div>
      </DashboardLayout>
    );
  }
  return (
    <DashboardLayout>
      <div lang={locale}>
        <Start languageForm={languageForm} />
      </div>
    </DashboardLayout>
  );
}

function Start({ languageForm }: { languageForm?: React.ReactNode }) {
  const text = useIpmText();
  const { t } = text;
  const router = useRouter();
  const [code, setCode] = useState("");
  const [finding, setFinding] = useState(false);
  const [device, setDevice] = useState<RegisterDevice | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [clientRef, setClientRef] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const [refusal, setRefusal] = useState<{ message: string; draftId: string | null } | null>(null);
  const [scanning, setScanning] = useState(false);
  // Read on the client only: the server renders without the camera button (no hydration mismatch).
  const scannable = useSyncExternalStore(noSubscription, canScan, () => false);

  const find = useCallback(
    async (value: string) => {
      const sticker = value.trim();
      if (!sticker) return;
      setFinding(true);
      setFindError(null);
      setDevice(null);
      setRefusal(null);
      try {
        const found = await calibrationDatesService.findDeviceByQr(sticker);
        setDevice(found);
        setClientRef(newClientRef());
      } catch (err) {
        const details = describeApiError(err);
        setFindError(details.status === 404 ? t("ipm.start.notFound", { code: sticker }) : details.message || t("ipm.start.findFailed"));
      } finally {
        setFinding(false);
      }
    },
    [t],
  );

  const onScanned = useCallback(
    (scanned: string) => {
      setScanning(false);
      setCode(scanned);
      void find(scanned);
    },
    [find],
  );

  const start = async () => {
    if (!device) return;
    setStarting(true);
    setRefusal(null);
    try {
      const draft = await ipmHistoryService.create(device.id, clientRef);
      router.push(`/dashboard/ipm/capture/${draft.id}`);
    } catch (err) {
      setRefusal({ message: describeApiError(err).message || t("ipm.start.failed"), draftId: draftIdOf(err) });
      setStarting(false);
    }
  };

  const ownDraft = device?.openIpmDraftId ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-primary" aria-hidden="true" />
            {t("ipm.start.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("ipm.start.lead")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{languageForm}</div>
      </div>

      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void find(code);
            }}
          >
            <label htmlFor="ipm-start-qr" className="block text-sm font-semibold">
              {t("ipm.start.qr")}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="ipm-start-qr"
                className={`${FIELD} min-h-11 flex-1 font-mono uppercase`}
                value={code}
                maxLength={64}
                autoComplete="off"
                aria-describedby="ipm-start-qr-help"
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type="submit" className="min-h-11" isLoading={finding} leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}>
                {t("ipm.start.find")}
              </Button>
              {scannable && (
                <Button type="button" variant="outline" className="min-h-11" leftIcon={<Camera className="h-4 w-4" aria-hidden="true" />} onClick={() => setScanning(true)}>
                  {t("ipm.scan.button")}
                </Button>
              )}
            </div>
            <p id="ipm-start-qr-help" className="text-xs text-muted-foreground">
              {scannable ? t("ipm.start.qrHelp") : t("ipm.start.qrHelpNoCamera")}
            </p>
          </form>
          {findError && (
            <div role="alert">
              <Alert variant="error" title={t("ipm.start.notFoundTitle")}>
                <p>{findError}</p>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      {device && (
        <Card className="border-border">
          <CardContent className="pt-6 space-y-4">
            <h2 className="text-lg font-semibold">{device.name}</h2>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("ipm.start.qr")}</dt>
                <dd className="font-mono">{device.qrCode ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("ipm.start.serial")}</dt>
                <dd className="font-mono">{device.serialNumber ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("ipm.start.make")}</dt>
                <dd>{[device.manufacturer, device.model].filter(Boolean).join(" · ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("ipm.col.facility")}</dt>
                <dd>{device.clientFacility?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("ipm.col.room")}</dt>
                <dd>{[device.warehouse?.name, device.warehouse?.floor].filter(Boolean).join(" · ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("ipm.start.lastIpm")}</dt>
                <dd>{device.lastIpm ? text.day(device.lastIpm.performedAt) : t("ipm.start.never")}</dd>
              </div>
            </dl>
            {ownDraft && (
              <p className="text-sm">
                {t("ipm.start.ownDraft")}{" "}
                <Link href={`/dashboard/ipm/capture/${ownDraft}`} className="text-primary underline underline-offset-2">
                  {t("ipm.start.resume")}
                </Link>
              </p>
            )}
            {refusal && (
              <div role="alert">
                <Alert variant="error" title={t("ipm.start.refusedTitle")}>
                  <p>{refusal.message}</p>
                  {refusal.draftId && (
                    <Link href={`/dashboard/ipm/capture/${refusal.draftId}`} className="mt-2 inline-block text-primary underline underline-offset-2">
                      {t("ipm.start.resume")}
                    </Link>
                  )}
                </Alert>
              </div>
            )}
            {!ownDraft && (
              <Button className="min-h-11 w-full sm:w-auto" isLoading={starting} onClick={() => void start()}>
                {t("ipm.start.begin")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-sm">
        <Link href="/dashboard/ipm" className="text-primary underline underline-offset-2">
          {t("ipm.start.history")}
        </Link>
      </p>

      {scanning && <QrScanner onCode={onScanned} onClose={() => setScanning(false)} />}
    </div>
  );
}
