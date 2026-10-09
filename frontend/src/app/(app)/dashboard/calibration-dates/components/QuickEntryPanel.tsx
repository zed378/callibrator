"use client";

/**
 * P22-05 — the quick calibration-date entry (F-62; P19-05 spec § 7.1): scan or type the device's QR
 * sticker → the device, its last calibration and its room → confirm or change the room, enter the
 * date, the laboratory (the device's own pre-selected), optionally the certificate number, the next
 * date the certificate states and the laboratory's verdict → save. No file is stored; every save is a
 * new record (history is kept, nothing is overwritten). A same-day entry is warned about before
 * saving and accepted (the server answers it with a notice); a retired device or an ended facility is
 * a 409 whose state explanation is shown as the server wrote it.
 *
 * A typed QR is what a handheld scanner types too; the camera scan is the field app's (P22-03).
 */
import React, { useRef, useState } from "react";
import { QrCode, Search } from "lucide-react";
import { Alert, Button, Card, CardContent, ErrorState, StatusBadge } from "@/components/ui";
import { describeApiError } from "@/api/client";
import {
  calibrationDatesService,
  type Device,
  type ExternalCalibrationRecord,
  type Laboratory,
} from "@/api/services/calibrationDates.service";
import { useToastStore } from "@/stores/toastStore";
import type { MessageKey } from "@/i18n";
import { buildBody, deviceRoom, emptyForm, entryProblems, todayDay, EARLIEST_DAY, type EntryForm, type LabMode, type Verdict } from "../entry";
import { FIELD, useDatesText } from "./shared";

type Lookup =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; device: Device }
  | { status: "missing"; qr: string }
  | { status: "invalid"; message: string }
  | { status: "failed"; error: unknown };

interface Saved {
  deviceName: string;
  record: ExternalCalibrationRecord;
  requestCleared: boolean;
}

export function QuickEntryPanel({ canPickLab, showFacility }: { canPickLab: boolean; showFacility: boolean }) {
  const text = useDatesText();
  const { t } = text;
  const addToast = useToastStore((s) => s.addToast);
  const [qr, setQr] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const [form, setForm] = useState<EntryForm | null>(null);
  const [labs, setLabs] = useState<Laboratory[] | null>(null);
  const [labsError, setLabsError] = useState<unknown>(null);
  const [sameDay, setSameDay] = useState(0);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const sameDayRequest = useRef(0);
  const qrInput = useRef<HTMLInputElement>(null);

  const device = lookup.status === "found" ? lookup.device : null;
  const today = todayDay();
  const problems = form ? entryProblems(form, today) : [];

  const loadLabs = async () => {
    setLabsError(null);
    try {
      setLabs(await calibrationDatesService.laboratories());
    } catch (err) {
      setLabs(null);
      setLabsError(err);
    }
  };

  /** The soft duplicate warning: entries of this device on this day (answers out of order are dropped). */
  const checkSameDay = async (deviceId: string, day: string) => {
    const request = sameDayRequest.current + 1;
    sameDayRequest.current = request;
    setSameDay(0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    try {
      const count = await calibrationDatesService.sameDayEntries(deviceId, day);
      if (sameDayRequest.current === request) setSameDay(count);
    } catch {
      // The warning is a convenience; the server's notice after saving still says it.
    }
  };

  const find = async (event: React.FormEvent) => {
    event.preventDefault();
    await lookUp(qr.trim());
  };

  const lookUp = async (code: string) => {
    if (!code) return;
    setLookup({ status: "loading" });
    setForm(null);
    setSaved(null);
    setSaveError(null);
    setShowProblems(false);
    try {
      const found = await calibrationDatesService.findDeviceByQr(code);
      const fresh = emptyForm(found, canPickLab, today);
      setLookup({ status: "found", device: found });
      setForm(fresh);
      if (canPickLab && labs === null) void loadLabs();
      void checkSameDay(found.id, fresh.calibrationDate);
    } catch (err) {
      const details = describeApiError(err);
      if (details.status === 404) setLookup({ status: "missing", qr: code });
      else if (details.status === 400) setLookup({ status: "invalid", message: details.message });
      else setLookup({ status: "failed", error: err });
    }
  };

  const update = (patch: Partial<EntryForm>) => {
    if (!form) return;
    setForm({ ...form, ...patch });
  };

  const reset = () => {
    setLookup({ status: "idle" });
    setForm(null);
    setQr("");
    setSaveError(null);
    setShowProblems(false);
    qrInput.current?.focus();
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || !device) return;
    setShowProblems(true);
    if (problems.length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const record = await calibrationDatesService.recordDate(device.id, buildBody(form, device));
      setSaved({
        deviceName: device.name,
        record,
        requestCleared: Boolean(device.calibrationRequestedAt) && !record.device.calibrationRequestedAt,
      });
      addToast({ type: "success", title: t("calibrationDates.entry.savedToast", { name: device.name }) });
      reset();
    } catch (err) {
      setSaveError(describeApiError(err).message || t("calibrationDates.entry.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{t("calibrationDates.entry.heading")}</h2>
          <p className="text-sm text-muted-foreground max-w-3xl">{t("calibrationDates.entry.lead")}</p>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void find(e)} role="search" aria-label={t("calibrationDates.entry.findLabel")}>
            <div className="flex-1 min-w-56 space-y-1.5">
              <label htmlFor="entry-qr" className="block text-sm font-semibold">
                {t("calibrationDates.entry.qr")}
              </label>
              <input
                id="entry-qr"
                ref={qrInput}
                className={`${FIELD} font-mono uppercase`}
                value={qr}
                maxLength={64}
                autoComplete="off"
                inputMode="text"
                aria-describedby="entry-qr-help"
                onChange={(e) => setQr(e.target.value)}
              />
              <p id="entry-qr-help" className="text-xs text-muted-foreground">
                {t("calibrationDates.entry.qrHelp")}
              </p>
            </div>
            <Button type="submit" isLoading={lookup.status === "loading"} disabled={!qr.trim()} leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}>
              {t("calibrationDates.entry.find")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {saved && <SavedNotice saved={saved} onDismiss={() => setSaved(null)} />}

      {lookup.status === "missing" && (
        <div role="alert">
          <Alert variant="warning" title={t("calibrationDates.entry.notFoundTitle")}>
            <p>{t("calibrationDates.entry.notFound", { qr: lookup.qr })}</p>
          </Alert>
        </div>
      )}
      {lookup.status === "invalid" && (
        <div role="alert">
          <Alert variant="warning" title={t("calibrationDates.entry.invalidTitle")}>
            <p>{lookup.message}</p>
          </Alert>
        </div>
      )}
      {lookup.status === "failed" && <ErrorState error={lookup.error} onRetry={() => void lookUp(qr.trim())} />}

      {device && form && (
        <>
          <DeviceSummary device={device} showFacility={showFacility} />
          {device.status === "retired" ? (
            <div role="alert">
              <Alert variant="warning" title={t("calibrationDates.entry.retiredTitle")}>
                <p>{t("calibrationDates.entry.retired")}</p>
              </Alert>
            </div>
          ) : (
            <Card className="border-border">
              <CardContent className="pt-6">
                <form className="space-y-5" noValidate onSubmit={(e) => void save(e)} aria-labelledby="entry-form-heading">
                  <h3 id="entry-form-heading" className="text-base font-semibold">
                    {t("calibrationDates.entry.formHeading", { name: device.name })}
                  </h3>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="entry-date" className="block text-sm font-semibold">
                        {t("calibrationDates.entry.date")}
                      </label>
                      <input
                        id="entry-date"
                        type="date"
                        required
                        className={FIELD}
                        value={form.calibrationDate}
                        min={EARLIEST_DAY}
                        max={today}
                        onChange={(e) => {
                          update({ calibrationDate: e.target.value });
                          void checkSameDay(device.id, e.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="entry-due" className="block text-sm font-semibold">
                        {t("calibrationDates.entry.dueDate")}
                      </label>
                      <input
                        id="entry-due"
                        type="date"
                        className={FIELD}
                        value={form.dueDate}
                        aria-describedby="entry-due-help"
                        onChange={(e) => update({ dueDate: e.target.value })}
                      />
                      <p id="entry-due-help" className="text-xs text-muted-foreground">
                        {t("calibrationDates.entry.dueDateHelp")}
                      </p>
                    </div>
                  </div>

                  {sameDay > 0 && (
                    <div role="status">
                      <Alert variant="warning" title={t("calibrationDates.entry.sameDayTitle")}>
                        <p>{t("calibrationDates.entry.sameDay")}</p>
                      </Alert>
                    </div>
                  )}

                  <LabFields device={device} form={form} update={update} canPickLab={canPickLab} labs={labs} labsError={labsError} onRetryLabs={() => void loadLabs()} />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="entry-certificate" className="block text-sm font-semibold">
                        {t("calibrationDates.entry.certificate")}
                      </label>
                      <input
                        id="entry-certificate"
                        className={FIELD}
                        value={form.certificateNumber}
                        maxLength={100}
                        autoComplete="off"
                        onChange={(e) => update({ certificateNumber: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="entry-verdict" className="block text-sm font-semibold">
                        {t("calibrationDates.entry.verdict")}
                      </label>
                      <select id="entry-verdict" className={FIELD} value={form.verdict} onChange={(e) => update({ verdict: e.target.value as Verdict })}>
                        <option value="unstated">{t("calibrationDates.verdict.unstated")}</option>
                        <option value="compliant">{t("calibrationDates.verdict.compliant")}</option>
                        <option value="non_compliant">{t("calibrationDates.verdict.non_compliant")}</option>
                      </select>
                    </div>
                  </div>

                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold">{t("calibrationDates.entry.room")}</legend>
                    <p className="text-xs text-muted-foreground">
                      {deviceRoom(device) ? t("calibrationDates.entry.roomConfirm") : t("calibrationDates.entry.roomNone")}
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label htmlFor="entry-room" className="block text-sm">
                          {t("calibrationDates.entry.roomName")}
                        </label>
                        <input id="entry-room" className={FIELD} value={form.roomName} maxLength={255} onChange={(e) => update({ roomName: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="entry-floor" className="block text-sm">
                          {t("calibrationDates.entry.roomFloor")}
                        </label>
                        <input id="entry-floor" className={FIELD} value={form.roomFloor} maxLength={50} onChange={(e) => update({ roomFloor: e.target.value })} />
                      </div>
                    </div>
                  </fieldset>

                  <div className="space-y-1.5">
                    <label htmlFor="entry-notes" className="block text-sm font-semibold">
                      {t("calibrationDates.entry.notes")}
                    </label>
                    <textarea id="entry-notes" className={FIELD} rows={3} maxLength={2000} value={form.notes} onChange={(e) => update({ notes: e.target.value })} />
                  </div>

                  {showProblems && problems.length > 0 && (
                    <div role="alert">
                      <Alert variant="error" title={t("calibrationDates.entry.problemsTitle")}>
                        <ul className="list-disc pl-5">
                          {problems.map((p) => (
                            <li key={p}>{t(`calibrationDates.problem.${p}` as MessageKey)}</li>
                          ))}
                        </ul>
                      </Alert>
                    </div>
                  )}

                  {saveError && (
                    <div role="alert">
                      <Alert variant="error" title={t("calibrationDates.entry.refusedTitle")}>
                        <p>{saveError}</p>
                      </Alert>
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" onClick={reset}>
                      {t("calibrationDates.entry.cancel")}
                    </Button>
                    <Button type="submit" isLoading={saving}>
                      {t("calibrationDates.entry.save")}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** The device the sticker names: identity, facility, room, last calibration and what is due. */
function DeviceSummary({ device, showFacility }: { device: Device; showFacility: boolean }) {
  const text = useDatesText();
  const { t } = text;
  const room = deviceRoom(device);
  const last = device.lastCalibration;
  const due = device.calibrationDue;
  const make = [device.manufacturer, device.model].filter(Boolean).join(" · ");
  return (
    <Card className="border-border">
      <CardContent className="pt-6 space-y-3">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <QrCode className="h-5 w-5 text-primary" aria-hidden="true" />
          {device.name}
        </h3>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact term={t("calibrationDates.device.qr")} value={<span className="font-mono">{device.qrCode ?? "—"}</span>} />
          <Fact term={t("calibrationDates.device.type")} value={device.deviceType?.name ?? "—"} />
          <Fact term={t("calibrationDates.device.make")} value={make || "—"} />
          <Fact term={t("calibrationDates.device.serial")} value={device.serialNumber ?? "—"} />
          {showFacility && <Fact term={t("calibrationDates.device.facility")} value={device.clientFacility?.name ?? "—"} />}
          <Fact term={t("calibrationDates.device.room")} value={room ? [room.name, room.floor].filter(Boolean).join(" · ") : "—"} />
          <Fact
            term={t("calibrationDates.device.lastCalibration")}
            value={
              last
                ? `${text.date(last.date)} · ${last.externalLabName ?? text.kind(last.entryKind)}`
                : t("calibrationDates.device.never")
            }
          />
          <Fact
            term={t("calibrationDates.device.next")}
            value={
              <span className="inline-flex flex-wrap items-center gap-2">
                {text.date(due?.nextCalibrationDate ?? device.nextCalibrationDate)}
                {due && (
                  <StatusBadge domain="calibrationDue" state={due.state} size="sm">
                    {text.due(due.state)}
                  </StatusBadge>
                )}
              </span>
            }
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function Fact({ term, value }: { term: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

interface LabFieldsProps {
  device: Device;
  form: EntryForm;
  update: (patch: Partial<EntryForm>) => void;
  canPickLab: boolean;
  labs: Laboratory[] | null;
  labsError: unknown;
  onRetryLabs: () => void;
}

/** The laboratory: the device's own, one from the tenant's laboratories, or a typed name. */
function LabFields({ device, form, update, canPickLab, labs, labsError, onRetryLabs }: LabFieldsProps) {
  const { t } = useDatesText();
  const modes: LabMode[] = [...(device.calibrationVendorId ? (["device"] as const) : []), ...(canPickLab ? (["list"] as const) : []), "typed"];
  const deviceLab = device.calibrationVendorDisplay?.name ?? t("calibrationDates.entry.labDeviceUnnamed");
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">{t("calibrationDates.entry.lab")}</legend>
      <div className="flex flex-col gap-2">
        {modes.map((mode) => (
          <label key={mode} className="inline-flex items-center gap-2 text-sm">
            <input type="radio" name="entry-lab-mode" value={mode} checked={form.labMode === mode} onChange={() => update({ labMode: mode })} />
            {mode === "device" ? t("calibrationDates.entry.labDevice", { name: deviceLab }) : t(`calibrationDates.entry.labMode.${mode}` as MessageKey)}
          </label>
        ))}
      </div>
      {form.labMode === "list" && (
        <div className="space-y-1.5">
          <label htmlFor="entry-lab" className="block text-sm">
            {t("calibrationDates.entry.labPick")}
          </label>
          {labsError !== null ? (
            <ErrorState error={labsError} onRetry={onRetryLabs} />
          ) : labs === null ? (
            <p className="text-sm text-muted-foreground">{t("calibrationDates.loading")}</p>
          ) : labs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("calibrationDates.entry.labNone")}</p>
          ) : (
            <select id="entry-lab" className={FIELD} value={form.vendorId} onChange={(e) => update({ vendorId: e.target.value })}>
              <option value="">{t("calibrationDates.entry.labChoose")}</option>
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {form.labMode === "typed" && (
        <div className="space-y-1.5">
          <label htmlFor="entry-lab-name" className="block text-sm">
            {t("calibrationDates.entry.labName")}
          </label>
          <input id="entry-lab-name" className={FIELD} value={form.labName} maxLength={255} onChange={(e) => update({ labName: e.target.value })} />
        </div>
      )}
    </fieldset>
  );
}

/** What the save did: the record, the device's next date as now derived, and the server's notices. */
function SavedNotice({ saved, onDismiss }: { saved: Saved; onDismiss: () => void }) {
  const text = useDatesText();
  const { t } = text;
  const next = saved.record.device.nextCalibrationDate;
  return (
    <div role="status">
      <Alert variant="success" title={t("calibrationDates.saved.title", { name: saved.deviceName })}>
        <p>
          {next ? t("calibrationDates.saved.next", { date: text.date(next) }) : t("calibrationDates.saved.noNext")}
        </p>
        {saved.requestCleared && <p>{t("calibrationDates.saved.requestCleared")}</p>}
        {saved.record.notices.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {saved.record.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        )}
        <Button size="sm" variant="ghost" className="mt-2" onClick={onDismiss}>
          {t("calibrationDates.saved.dismiss")}
        </Button>
      </Alert>
    </div>
  );
}
