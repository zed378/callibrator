"use client";

/**
 * P22-03 (F-36 … F-53) — the IPM capture: a mobile-first stepper over the pinned checklist, one
 * section a step (environment, electrical supply, tools used, other safety, physical, electrical
 * safety, function, completeness, performance, battery, maintenance tasks, consumables), then the
 * visit's header (date, room, outcomes, recommendation, notes) and a review that submits.
 *
 * - **Autosave.** Every change is saved after a short pause: the results as one `PUT …/results`,
 *   the header as one `PATCH` of what changed, each at the revision last read; the writes run one
 *   after another so each carries the revision the previous one answered. The state of the save is
 *   always shown ("saving", "saved at …", the server's refusal). A stale revision (409
 *   `IPM_REVISION_CONFLICT`: the draft was saved elsewhere) stops the autosave and offers a reload.
 * - **The server's rules, before the round trip.** Each answer is checked with `normaliseResult`
 *   (the contract the server applies): a reading outside the possible range, an override of a
 *   computed outcome — said on the field and not sent; the review lists the required items still
 *   missing (`missingRequiredItems`) and Submit stays off until there are none.
 * - **Submit** saves what is pending, then `POST …/submit` at the current revision; the visit
 *   number and the server's notices (a repair order opened, the device set to maintenance …) are
 *   shown. A draft can be discarded from the review.
 *
 * Who: the draft's creator (the server answers 403 to anyone else; the page says so). Offline
 * capture is P22-10's (`/field`); this page needs the network.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, Plus, Shield } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Alert, Button, Card, CardContent } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { deviceRegisterService } from "@/api/services/deviceRegister.service";
import { ipmHistoryService, type IpmHeaderBody, type IpmSession, type Room, type TemplateVersion } from "@/api/services/ipmHistory.service";
import { usePermissions } from "@/hooks/usePermissions";
import { deferEffect } from "@/lib/deferEffect";
import { useI18n } from "@/i18n/MessagesProvider";
import { AD_HOC_SECTIONS } from "@callibrator/contracts/inspectionSessions";
import { INSPECTION_SECTIONS } from "@callibrator/contracts/inspectionValues";
import {
  EMPTY_ANSWER,
  isAnswered,
  missingOf,
  newAdHoc,
  problemsOf,
  resultInputs,
  stateFromResults,
  stepsOf,
  type Answer,
  type CaptureState,
  type TemplateItem,
} from "../../capture";
import { localInput, noticesOf, visitLabel, type Recommendation } from "../../history";
import { ItemField } from "../../components/ItemField";
import { FIELD, Field, useIpmText } from "../../components/shared";

/** The pause after the last change before it is saved. */
export const AUTOSAVE_MS = 1200;

type Overall = "" | "pass" | "fail";
export interface Header {
  performedAt: string;
  locationId: string | null;
  roomLabel: string;
  inspectionOutcome: Overall;
  maintenanceOutcome: Overall;
  recommendation: "" | Recommendation;
  notes: string;
}

const headerOf = (s: IpmSession): Header => ({
  performedAt: localInput(s.performedAt),
  locationId: s.locationId,
  roomLabel: "",
  inspectionOutcome: s.inspectionOutcome ?? "",
  maintenanceOutcome: s.maintenanceOutcome ?? "",
  recommendation: s.recommendation ?? "",
  notes: s.notes ?? "",
});

/** The header's PATCH: only what differs from what was saved (the revision added by the caller). */
export const headerChanges = (h: Header, saved: Header): Omit<IpmHeaderBody, "revision"> => {
  const body: Omit<IpmHeaderBody, "revision"> = {};
  if (h.performedAt !== saved.performedAt && h.performedAt) body.performedAt = new Date(h.performedAt).toISOString();
  if (h.locationId !== saved.locationId) body.locationId = h.locationId;
  if (h.inspectionOutcome !== saved.inspectionOutcome) body.inspectionOutcome = h.inspectionOutcome || null;
  if (h.maintenanceOutcome !== saved.maintenanceOutcome) body.maintenanceOutcome = h.maintenanceOutcome || null;
  if (h.recommendation !== saved.recommendation) body.recommendation = h.recommendation || null;
  if (h.notes.trim() !== saved.notes.trim()) body.notes = h.notes.trim() === "" ? null : h.notes.trim();
  return body;
};

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "failed"; message: string } | { kind: "conflict"; message: string };

const RECOMMENDATIONS: Recommendation[] = ["fit_for_use", "needs_calibration", "not_fit_for_use", "needs_repair"];

const sortItems = (items: readonly TemplateItem[]): TemplateItem[] =>
  [...items].sort((a, b) => INSPECTION_SECTIONS.indexOf(a.section) - INSPECTION_SECTIONS.indexOf(b.section) || a.sortOrder - b.sortOrder);

export function CaptureClient({ sessionId, languageForm, autosaveMs = AUTOSAVE_MS }: { sessionId: string; languageForm?: React.ReactNode; autosaveMs?: number }) {
  const { locale } = useI18n();
  const { t } = useIpmText();
  const permissions = usePermissions();

  if (!permissions.loaded) {
    return (
      <DashboardLayout>
        <div lang={locale}>
          <h1 className="sr-only">{t("ipm.capture.title")}</h1>
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
          <h1 className="text-xl font-semibold text-foreground mb-2">{t("ipm.capture.title")}</h1>
          <p className="text-muted-foreground">{t("ipm.start.restricted")}</p>
        </div>
      </DashboardLayout>
    );
  }
  return (
    <DashboardLayout>
      <div lang={locale}>
        <Loader sessionId={sessionId} languageForm={languageForm} autosaveMs={autosaveMs} />
      </div>
    </DashboardLayout>
  );
}

interface Loaded {
  session: IpmSession;
  version: TemplateVersion;
  roomName: string | null;
}

function Loader({ sessionId, languageForm, autosaveMs }: { sessionId: string; languageForm?: React.ReactNode; autosaveMs: number }) {
  const { t } = useIpmText();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(
    () =>
      deferEffect(async () => {
        setLoaded(null);
        setError(null);
        try {
          const session = await ipmHistoryService.get(sessionId);
          if (!session.templateVersionId) throw new Error(t("ipm.capture.noChecklist"));
          const version = await ipmHistoryService.templateVersion(session.templateVersionId);
          let roomName: string | null = null;
          try {
            const device = await deviceRegisterService.get(session.deviceId);
            roomName = [device.warehouse?.name, device.warehouse?.floor].filter(Boolean).join(" · ") || null;
          } catch {
            roomName = null;
          }
          setLoaded({ session, version, roomName });
        } catch (err) {
          setError(err);
        }
      }),
    [sessionId, generation, t],
  );

  if (error !== null) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("ipm.capture.title")}</h1>
        <div role="alert">
          <Alert variant="error" title={t("ipm.capture.loadFailed")}>
            <p>{describeApiError(error).message}</p>
          </Alert>
        </div>
        <Link href="/dashboard/ipm" className="text-primary underline underline-offset-2">
          {t("ipm.start.history")}
        </Link>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="sr-only">{t("ipm.capture.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("ipm.loading")}</p>
      </div>
    );
  }
  if (loaded.session.status !== "draft") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("ipm.capture.title")}</h1>
        <p>{t("ipm.capture.notDraft")}</p>
        <Link href="/dashboard/ipm" className="text-primary underline underline-offset-2">
          {t("ipm.start.history")}
        </Link>
      </div>
    );
  }
  return <Capture key={`${loaded.session.id}-${String(generation)}`} loaded={loaded} languageForm={languageForm} autosaveMs={autosaveMs} onReload={() => setGeneration((g) => g + 1)} />;
}

function Capture({ loaded, languageForm, autosaveMs, onReload }: { loaded: Loaded; languageForm?: React.ReactNode; autosaveMs: number; onReload: () => void }) {
  const text = useIpmText();
  const { t } = text;
  const { session } = loaded;
  const items = useMemo(() => sortItems(loaded.version.items), [loaded.version.items]);
  const steps = useMemo(() => stepsOf(items), [items]);
  const [step, setStep] = useState(0);
  const [capture, setCapture] = useState<CaptureState>(() => stateFromResults(session.results));
  const [header, setHeader] = useState<Header>(() => ({ ...headerOf(session), roomLabel: loaded.roomName ?? "" }));
  const [revision, setRevision] = useState(session.revision);
  const [savedResults, setSavedResults] = useState(() => JSON.stringify(resultInputs(items, stateFromResults(session.results))));
  const [savedHeader, setSavedHeader] = useState<Header>(() => ({ ...headerOf(session), roomLabel: loaded.roomName ?? "" }));
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<IpmSession | null>(null);
  const [discarded, setDiscarded] = useState(false);
  const [finalRefusal, setFinalRefusal] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(1);

  const inputs = useMemo(() => resultInputs(items, capture), [items, capture]);
  const resultsKey = useMemo(() => JSON.stringify(inputs), [inputs]);
  const problems = useMemo(() => problemsOf(items, capture), [items, capture]);
  const hasProblems = Object.keys(problems).length > 0;
  const changes = headerChanges(header, savedHeader);
  const headerDirty = Object.keys(changes).length > 0;
  const resultsDirty = resultsKey !== savedResults;
  const stopped = save.kind === "conflict" || submitted !== null || discarded;

  /** One write; its answer's revision is the next write's. */
  const write = useCallback(
    async (kind: "results" | "header", at: number): Promise<number | null> => {
      setSave({ kind: "saving" });
      try {
        const answer =
          kind === "results"
            ? await ipmHistoryService.saveResults(session.id, { revision: at, results: inputs })
            : await ipmHistoryService.editHeader(session.id, { revision: at, ...changes });
        if (kind === "results") setSavedResults(resultsKey);
        else setSavedHeader(header);
        setRevision(answer.revision);
        setSave({ kind: "saved", at: new Date() });
        return answer.revision;
      } catch (err) {
        const details = describeApiError(err);
        const message = details.message || t("ipm.capture.saveFailed");
        setSave(details.code === "IPM_REVISION_CONFLICT" ? { kind: "conflict", message } : { kind: "failed", message });
        return null;
      }
    },
    [session.id, inputs, changes, resultsKey, header, t],
  );

  // Autosave, a pause after the last change: the results first, then the header, one at a time.
  useEffect(() => {
    if (stopped || busy || save.kind === "saving" || save.kind === "failed" || (!resultsDirty && !headerDirty) || (resultsDirty && hasProblems && !headerDirty)) return undefined;
    const timer = setTimeout(() => {
      void (async () => {
        if (resultsDirty && !hasProblems) {
          const next = await write("results", revision);
          if (next !== null && headerDirty) await write("header", next);
        } else if (headerDirty) {
          await write("header", revision);
        }
      })();
    }, autosaveMs);
    return () => clearTimeout(timer);
  }, [resultsKey, header, stopped, busy, save.kind, resultsDirty, headerDirty, hasProblems, write, revision, autosaveMs]);

  /** A change after a refused save tries again (the refusal stays until then; no retry loop). */
  const edited = () => {
    if (save.kind === "failed") setSave({ kind: "idle" });
  };
  const setAnswer = (key: string, patch: Partial<Answer>) => {
    edited();
    setCapture((c) => ({ ...c, answers: { ...c.answers, [key]: { ...(c.answers[key] ?? EMPTY_ANSWER), ...patch } } }));
  };
  const setAdHoc = (key: string, patch: Partial<CaptureState["adHoc"][number]>) => {
    edited();
    setCapture((c) => ({ ...c, adHoc: c.adHoc.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  };
  const editHeader = (next: Header) => {
    edited();
    setHeader(next);
  };

  const missing = missingOf(items, capture);
  const current = steps[step] ?? { kind: "review" as const };

  const submit = async () => {
    setBusy(true);
    setFinalRefusal(null);
    try {
      let at = revision;
      if (resultsDirty) {
        const next = await write("results", at);
        if (next === null) return;
        at = next;
      }
      if (headerDirty) {
        const next = await write("header", at);
        if (next === null) return;
        at = next;
      }
      setSubmitted(await ipmHistoryService.submit(session.id, at));
    } catch (err) {
      setFinalRefusal(describeApiError(err).message || t("ipm.capture.submitFailed"));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    setFinalRefusal(null);
    try {
      await ipmHistoryService.discard(session.id);
      setDiscarded(true);
    } catch (err) {
      setFinalRefusal(describeApiError(err).message || t("ipm.capture.submitFailed"));
    } finally {
      setBusy(false);
    }
  };

  const deviceName = session.device?.name ?? t("ipm.list.unknownDevice");

  if (submitted || discarded) {
    const notices = submitted ? noticesOf(submitted) : [];
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-status-current" aria-hidden="true" />
          {submitted ? t("ipm.capture.submittedTitle", { visit: visitLabel(submitted.visitNumber) ?? "—" }) : t("ipm.capture.discardedTitle")}
        </h1>
        <p>{deviceName}</p>
        {notices.length > 0 && (
          <div role="status">
            <Alert variant="info" title={t("ipm.session.notices")}>
              <ul className="list-disc pl-5">
                {notices.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {/* P23-02 (P19-06 § 7.2): online, the signature follows the submit. */}
          {submitted && (
            <Link href={`/dashboard/ipm/sessions/${submitted.id}/report`} className="font-semibold text-primary underline underline-offset-2">
              {t("ipm.capture.signReport")}
            </Link>
          )}
          <Link href="/dashboard/ipm/new" className="text-primary underline underline-offset-2">
            {t("ipm.capture.another")}
          </Link>
          <Link href="/dashboard/ipm" className="text-primary underline underline-offset-2">
            {t("ipm.start.history")}
          </Link>
        </div>
      </div>
    );
  }

  const stepLabel = (s: (typeof steps)[number]): string =>
    s.kind === "section" ? text.section(s.section) : s.kind === "header" ? t("ipm.capture.headerStep") : t("ipm.capture.reviewStep");
  const sectionCount = (section: string): string => {
    const own = items.filter((i) => i.section === section);
    const done = own.filter((i) => isAnswered(capture.answers[i.id] ?? EMPTY_ANSWER)).length;
    return `${String(done)}/${String(own.length)}`;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("ipm.capture.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {deviceName}
            {session.device?.qrCode ? ` · ${session.device.qrCode}` : ""}
            {session.templateVersionNumber !== null ? ` · ${t("ipm.session.checklist", { n: session.templateVersionNumber })}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{languageForm}</div>
      </div>

      <div role="status" aria-live="polite" className="text-sm">
        {save.kind === "saving" && <span>{t("ipm.capture.saving")}</span>}
        {save.kind === "saved" && <span>{t("ipm.capture.savedAt", { time: save.at.toLocaleTimeString(text.locale === "id" ? "id-ID" : "en-GB", { hour: "2-digit", minute: "2-digit" }) })}</span>}
        {save.kind === "idle" && (resultsDirty || headerDirty) && <span>{t("ipm.capture.unsaved")}</span>}
        {hasProblems && <span className="ml-2 text-destructive">{t("ipm.capture.problemsHold")}</span>}
      </div>
      {save.kind === "failed" && (
        <div role="alert">
          <Alert variant="error" title={t("ipm.capture.saveFailedTitle")}>
            <p>{save.message}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setSave({ kind: "idle" })}>
              {t("ipm.capture.retry")}
            </Button>
          </Alert>
        </div>
      )}
      {save.kind === "conflict" && (
        <div role="alert">
          <Alert variant="warning" title={t("ipm.capture.conflictTitle")}>
            <p>{save.message}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={onReload}>
              {t("ipm.capture.reload")}
            </Button>
          </Alert>
        </div>
      )}

      <nav aria-label={t("ipm.capture.steps")} className="overflow-x-auto">
        <ol className="flex gap-2">
          {steps.map((s, i) => (
            <li key={s.kind === "section" ? s.section : s.kind}>
              <button
                type="button"
                aria-current={i === step ? "step" : undefined}
                className={`min-h-11 whitespace-nowrap rounded-md border px-3 text-xs font-medium ${i === step ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-muted"}`}
                onClick={() => setStep(i)}
              >
                {stepLabel(s)}
                {s.kind === "section" && items.some((it) => it.section === s.section) && <span className="ml-1 opacity-80">{sectionCount(s.section)}</span>}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{stepLabel(current)}</h2>

          {current.kind === "section" && (
            <div className="space-y-3">
              {items
                .filter((i) => i.section === current.section)
                .map((item) => (
                  <ItemField key={item.id} id={`item-${item.id}`} item={item} answer={capture.answers[item.id] ?? EMPTY_ANSWER} onChange={(p) => setAnswer(item.id, p)} />
                ))}
              {capture.adHoc
                .filter((r) => r.section === current.section)
                .map((row) => (
                  <ItemField
                    key={row.key}
                    id={`adhoc-${row.key}`}
                    item={row}
                    answer={row.answer}
                    onChange={(p) => setAdHoc(row.key, { answer: { ...row.answer, ...p } })}
                    adHoc={{
                      onEdit: (p) => setAdHoc(row.key, p),
                      onRemove: () => setCapture((c) => ({ ...c, adHoc: c.adHoc.filter((r) => r.key !== row.key) })),
                    }}
                  />
                ))}
              {items.every((i) => i.section !== current.section) && capture.adHoc.every((r) => r.section !== current.section) && (
                <p className="text-sm text-muted-foreground">{t("ipm.capture.sectionEmpty")}</p>
              )}
              {AD_HOC_SECTIONS.includes(current.section) && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => {
                    setCapture((c) => ({ ...c, adHoc: [...c.adHoc, newAdHoc(current.section, `new-${String(nextKey)}`)] }));
                    setNextKey((k) => k + 1);
                  }}
                >
                  {t("ipm.capture.adHoc.add", { section: text.section(current.section) })}
                </Button>
              )}
            </div>
          )}

          {current.kind === "header" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="capture-performed" label={t("ipm.draft.performedAt")}>
                <input
                  id="capture-performed"
                  type="datetime-local"
                  className={`${FIELD} min-h-11`}
                  value={header.performedAt}
                  onChange={(e) => editHeader({ ...header, performedAt: e.target.value })}
                />
              </Field>
              <RoomField header={header} onChange={(locationId, roomLabel) => editHeader({ ...header, locationId, roomLabel })} />
              {(["inspectionOutcome", "maintenanceOutcome"] as const).map((key) => (
                <Field key={key} id={`capture-${key}`} label={t(key === "inspectionOutcome" ? "ipm.session.inspection" : "ipm.session.maintenance")}>
                  <select id={`capture-${key}`} className={`${FIELD} min-h-11`} value={header[key]} onChange={(e) => editHeader({ ...header, [key]: e.target.value as Overall })}>
                    <option value="">{t("ipm.overall.unset")}</option>
                    <option value="pass">{text.overall("pass")}</option>
                    <option value="fail">{text.overall("fail")}</option>
                  </select>
                </Field>
              ))}
              <Field id="capture-recommendation" label={t("ipm.session.recommendation")}>
                <select
                  id="capture-recommendation"
                  className={`${FIELD} min-h-11`}
                  value={header.recommendation}
                  onChange={(e) => editHeader({ ...header, recommendation: e.target.value as Header["recommendation"] })}
                >
                  <option value="">{t("ipm.recommendation.none")}</option>
                  {RECOMMENDATIONS.map((r) => (
                    <option key={r} value={r}>
                      {text.recommendation(r)}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field id="capture-notes" label={t("ipm.session.notes")}>
                  <textarea id="capture-notes" rows={3} maxLength={4000} className={FIELD} value={header.notes} onChange={(e) => editHeader({ ...header, notes: e.target.value })} />
                </Field>
              </div>
            </div>
          )}

          {current.kind === "review" && (
            <div className="space-y-4">
              {missing.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold">{t("ipm.capture.missing", { count: missing.length })}</p>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {missing.map((m) => (
                      <li key={`${m.section}-${m.label}`}>
                        <button
                          type="button"
                          className="text-left underline underline-offset-2"
                          onClick={() => setStep(steps.findIndex((s) => s.kind === "section" && s.section === m.section))}
                        >
                          {text.section(m.section)}: {m.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm">{t("ipm.capture.complete")}</p>
              )}
              {hasProblems && <p className="text-sm text-destructive">{t("ipm.capture.problemsHold")}</p>}
              {!header.recommendation && <p className="text-sm text-muted-foreground">{t("ipm.capture.noRecommendation")}</p>}
              {finalRefusal && (
                <div role="alert">
                  <Alert variant="error" title={t("ipm.refused")}>
                    <p>{finalRefusal}</p>
                  </Alert>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button className="min-h-11" isLoading={busy} disabled={missing.length > 0 || hasProblems || stopped || busy} onClick={() => void submit()}>
                  {t("ipm.draft.submit")}
                </Button>
                <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => void discard()}>
                  {t("ipm.draft.discard")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between gap-2">
        <Button variant="outline" className="min-h-11" disabled={step === 0} leftIcon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />} onClick={() => setStep((s) => s - 1)}>
          {t("ipm.pager.previous")}
        </Button>
        <Button variant="outline" className="min-h-11" disabled={step >= steps.length - 1} onClick={() => setStep((s) => s + 1)}>
          {t("ipm.pager.next")}
          <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** F-53: the room — the device's own (kept), or another room of its facility found by name. */
function RoomField({ header, onChange }: { header: Header; onChange: (locationId: string | null, label: string) => void }) {
  const { t } = useIpmText();
  const [find, setFind] = useState("");
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (find.trim().length < 2) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      void ipmHistoryService
        .rooms(find.trim())
        .then((found) => {
          if (active) {
            setRooms(found);
            setFailed(false);
          }
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [find]);

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold">{t("ipm.capture.room")}</p>
      <p className="text-sm">{header.locationId === null ? t("ipm.capture.roomKept", { room: header.roomLabel || "—" }) : t("ipm.capture.roomChanged", { room: header.roomLabel })}</p>
      <label htmlFor="capture-room-find" className="block text-xs text-muted-foreground">
        {t("ipm.capture.roomFind")}
      </label>
      <input id="capture-room-find" type="search" className={`${FIELD} min-h-11`} value={find} maxLength={100} onChange={(e) => setFind(e.target.value)} />
      {failed && <p className="text-xs text-destructive">{t("ipm.capture.roomFailed")}</p>}
      {rooms !== null && find.trim().length >= 2 && (
        <ul className="space-y-1">
          {rooms.length === 0 && <li className="text-xs text-muted-foreground">{t("ipm.capture.roomNone")}</li>}
          {rooms.map((r) => {
            const label = [r.name, r.floor].filter(Boolean).join(" · ");
            return (
              <li key={r.id}>
                <button type="button" className="min-h-11 text-left text-sm underline underline-offset-2" onClick={() => onChange(r.id, label)}>
                  {t("ipm.capture.roomPick", { room: label })}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
