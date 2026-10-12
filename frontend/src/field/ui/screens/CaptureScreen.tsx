"use client";
/**
 * P22-10c2 — the offline IPM capture (P19-08 § 3.2, § 9): P22-03's stepper over the pinned version's
 * items, read from the LOCAL catalogue; every answer checked with the server's own rule
 * (`normaliseResult` via `checkAnswer`) and saved LOCALLY on every change (through the engine to
 * the encrypted store — online the engine then syncs it after a pause, offline it waits); the
 * header (date, room, outcomes, recommendation, notes) and evidence photos; a review listing what
 * a submit still misses (`missingRequiredItems`). "Submit" freezes the capture; the outbox sends it.
 *
 * A capture no longer in `editing` is shown read-only with its state (the outbox resolves it).
 */
import React, { useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AD_HOC_SECTIONS } from "@callibrator/contracts/inspectionSessions";
import { INSPECTION_OVERALL_OUTCOMES, INSPECTION_RECOMMENDATIONS } from "@callibrator/contracts/inspectionValues";
import { EMPTY_ANSWER, missingOf, newAdHoc, problemsOf, resultInputs, stepsOf, type Answer, type CaptureState } from "@/app/(app)/dashboard/ipm/capture";
import { ItemField } from "@/app/(app)/dashboard/ipm/components/ItemField";
import type { Capture } from "../../engine/model";
import { ScreenTitle } from "../FieldApp";
import { useField, useFieldStoreApi, useFieldText } from "../context";
import { go } from "../nav";
import { FIELD_INPUT, ScreenLink } from "./common";
import { versionById, type CatalogueItem } from "./checklist";
import { sortedItems, stateFromInputs } from "./captureState";
import { PhotoList } from "./PhotoList";

export function CaptureScreen({ localId }: { localId: string | null }) {
  const { t } = useFieldText();
  const capture = useField((s) => s.captures.find((c) => c.localId === localId) ?? null);
  const catalogue = useField((s) => s.catalogue);
  if (!capture || capture.kind !== "ipm") {
    return (
      <section className="space-y-3">
        <ScreenTitle>{t("field.capture.missingTitle")}</ScreenTitle>
        <ScreenLink view="outbox">{t("field.nav.outbox")}</ScreenLink>
      </section>
    );
  }
  const version = versionById(catalogue, capture.templateVersionId);
  if (!version) {
    return (
      <section className="space-y-3">
        <ScreenTitle>{t("field.capture.title")}</ScreenTitle>
        <Alert variant="warning" title={t("field.capture.noCatalogueTitle")}>
          <p>{t("field.capture.noCatalogue")}</p>
        </Alert>
      </section>
    );
  }
  return <Stepper key={capture.localId} capture={capture} items={sortedItems(version)} />;
}

type Header = { performedAt: string; locationId: string; inspectionOutcome: string; maintenanceOutcome: string; recommendation: string; notes: string };

const headerOf = (h: Readonly<Record<string, unknown>>): Header => {
  const s = (k: string) => (typeof h[k] === "string" ? (h[k] as string) : "");
  return { performedAt: s("performedAt"), locationId: s("locationId"), inspectionOutcome: s("inspectionOutcome"), maintenanceOutcome: s("maintenanceOutcome"), recommendation: s("recommendation"), notes: s("notes") };
};
/** The header as the PATCH carries it (empty = null; the date as ISO). */
const headerBody = (h: Header): Record<string, unknown> => ({
  ...(h.performedAt ? { performedAt: new Date(h.performedAt).toISOString() } : {}),
  locationId: h.locationId || null,
  inspectionOutcome: h.inspectionOutcome || null,
  maintenanceOutcome: h.maintenanceOutcome || null,
  recommendation: h.recommendation || null,
  notes: h.notes.trim() || null,
});
const localInput = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Stepper({ capture, items }: { capture: Capture; items: CatalogueItem[] }) {
  const { t, tk } = useFieldText();
  const api = useFieldStoreApi();
  const rooms = useField((s) => s.rooms);
  const device = useField((s) => (capture.deviceId ? s.index.byId(capture.deviceId) : null));
  const editable = capture.state === "editing";
  const [state, setState] = useState<CaptureState>(() => stateFromInputs(capture.results));
  const [header, setHeader] = useState<Header>(() => {
    const h = headerOf(capture.header);
    return { ...h, performedAt: h.performedAt ? localInput(h.performedAt) : "" };
  });
  const [step, setStep] = useState(0);
  const [nextKey, setNextKey] = useState(1);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const steps = stepsOf(items);
  const current = steps[step] ?? steps[0];
  const problems = problemsOf(items, state);
  const missing = missingOf(items, state);

  // Every change is written through, one write after another (the store is the source of truth).
  const persist = (next: CaptureState, nextHeader: Header) => {
    const results = resultInputs(items, next);
    writes.current = writes.current.then(() => api.getState().editCapture(capture.localId, { results, header: headerBody(nextHeader) })).catch(() => undefined);
  };
  const changeAnswer = (key: string, patch: Partial<Answer>) => {
    const next = { ...state, answers: { ...state.answers, [key]: { ...(state.answers[key] ?? EMPTY_ANSWER), ...patch } } };
    setState(next);
    persist(next, header);
  };
  const changeAdHoc = (key: string, change: (row: CaptureState["adHoc"][number]) => CaptureState["adHoc"][number] | null) => {
    const adHoc = state.adHoc.flatMap((row) => {
      if (row.key !== key) return [row];
      const changed = change(row);
      return changed ? [changed] : [];
    });
    const next = { ...state, adHoc };
    setState(next);
    persist(next, header);
  };
  const changeHeader = (patch: Partial<Header>) => {
    const next = { ...header, ...patch };
    setHeader(next);
    persist(state, next);
  };

  const submit = async () => {
    await writes.current;
    await api.getState().submit(capture.localId);
    go("outbox");
  };

  const stepLabel = (i: number): string => {
    const s = steps[i];
    if (!s) return "";
    return s.kind === "section" ? t(`ipmCatalogue.section.${s.section}` as "ipmCatalogue.section.environment") : s.kind === "header" ? t("field.capture.headerStep") : t("field.capture.reviewStep");
  };

  return (
    <section className="space-y-4">
      <ScreenTitle>{device ? t("field.capture.titleFor", { name: device.name }) : t("field.capture.title")}</ScreenTitle>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge domain="fieldCapture" state={capture.state}>
          {tk(`field.state.${capture.state}`)}
        </StatusBadge>
        {capture.capturedOffline && <span className="text-muted-foreground">{t("field.capture.offlineClaim")}</span>}
        <span className="text-muted-foreground">{t("field.capture.savedLocally")}</span>
      </div>
      {!editable && (
        <Alert variant="info" title={t("field.capture.readOnlyTitle")}>
          <p>{t("field.capture.readOnly")}</p>
        </Alert>
      )}
      <nav aria-label={t("field.capture.steps")}>
        <ol className="flex flex-wrap gap-1">
          {steps.map((_, i) => (
            <li key={i}>
              <button
                type="button"
                aria-current={i === step ? "step" : undefined}
                onClick={() => setStep(i)}
                className={`min-h-11 rounded-md px-3 text-xs font-medium ${i === step ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
              >
                {i + 1}. {stepLabel(i)}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="text-base font-semibold">{stepLabel(step)}</h2>
          {current?.kind === "section" && (
            <fieldset disabled={!editable} className="space-y-4">
              {items
                .filter((i) => i.section === current.section)
                .map((item) => (
                  <ItemField key={item.id} id={`field-item-${item.id}`} item={item} answer={state.answers[item.id] ?? EMPTY_ANSWER} onChange={(patch) => changeAnswer(item.id, patch)} />
                ))}
              {state.adHoc
                .filter((row) => row.section === current.section)
                .map((row) => (
                  <ItemField
                    key={row.key}
                    id={`field-adhoc-${row.key}`}
                    item={row}
                    answer={row.answer}
                    onChange={(patch) => changeAdHoc(row.key, (r) => ({ ...r, answer: { ...r.answer, ...patch } }))}
                    adHoc={{ onEdit: (patch) => changeAdHoc(row.key, (r) => ({ ...r, ...patch })), onRemove: () => changeAdHoc(row.key, () => null) }}
                  />
                ))}
              {AD_HOC_SECTIONS.includes(current.section) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const next = { ...state, adHoc: [...state.adHoc, newAdHoc(current.section, `new-${String(nextKey)}`)] };
                    setNextKey(nextKey + 1);
                    setState(next);
                    persist(next, header);
                  }}
                >
                  {t("ipm.capture.adHoc.add", { section: stepLabel(step) })}
                </Button>
              )}
            </fieldset>
          )}
          {current?.kind === "header" && (
            <fieldset disabled={!editable} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="field-cap-performedAt" className="block text-sm font-semibold">
                  {t("field.capture.performedAt")}
                </label>
                <input id="field-cap-performedAt" type="datetime-local" className={FIELD_INPUT} value={header.performedAt} onChange={(e) => changeHeader({ performedAt: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label htmlFor="field-cap-room" className="block text-sm font-semibold">
                  {t("field.device.room")}
                </label>
                <select id="field-cap-room" className={FIELD_INPUT} value={header.locationId} onChange={(e) => changeHeader({ locationId: e.target.value })}>
                  <option value="">{t("field.register.choose")}</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              {(["inspectionOutcome", "maintenanceOutcome"] as const).map((k) => (
                <div key={k} className="space-y-1">
                  <label htmlFor={`field-cap-${k}`} className="block text-sm font-semibold">
                    {t(`field.capture.${k}`)}
                  </label>
                  <select id={`field-cap-${k}`} className={FIELD_INPUT} value={header[k]} onChange={(e) => changeHeader({ [k]: e.target.value })}>
                    <option value="">{t("ipm.overall.unset")}</option>
                    {INSPECTION_OVERALL_OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {t(`ipm.overall.${o}`)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="space-y-1">
                <label htmlFor="field-cap-recommendation" className="block text-sm font-semibold">
                  {t("field.capture.recommendation")}
                </label>
                <select id="field-cap-recommendation" className={FIELD_INPUT} value={header.recommendation} onChange={(e) => changeHeader({ recommendation: e.target.value })}>
                  <option value="">{t("ipm.recommendation.none")}</option>
                  {INSPECTION_RECOMMENDATIONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`ipm.recommendation.${r}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="field-cap-notes" className="block text-sm font-semibold">
                  {t("field.capture.notes")}
                </label>
                <textarea id="field-cap-notes" rows={3} className={FIELD_INPUT} value={header.notes} onChange={(e) => changeHeader({ notes: e.target.value })} />
              </div>
              <PhotoList capture={capture} purpose="ipm_evidence" editable={editable} />
            </fieldset>
          )}
          {current?.kind === "review" && (
            <div className="space-y-3">
              {Object.keys(problems).length > 0 && <p className="text-sm text-destructive">{t("ipm.capture.problemsHold")}</p>}
              {missing.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold">{t("ipm.capture.missing", { count: missing.length })}</p>
                  <ul className="list-disc pl-5 text-sm">
                    {missing.map((m, i) => (
                      <li key={i}>
                        {t(`ipmCatalogue.section.${m.section}` as "ipmCatalogue.section.environment")}: {m.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm">{t("ipm.capture.complete")}</p>
              )}
              {!header.recommendation && <p className="text-sm text-muted-foreground">{t("ipm.capture.noRecommendation")}</p>}
              {editable && (
                <Button onClick={() => void submit()} disabled={missing.length > 0 || Object.keys(problems).length > 0}>
                  {t("field.capture.submit")}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">{t("field.capture.submitLead")}</p>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-between gap-2">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
          {t("field.capture.previous")}
        </Button>
        <Button variant="outline" disabled={step >= steps.length - 1} onClick={() => setStep(step + 1)}>
          {t("field.capture.next")}
        </Button>
      </div>
    </section>
  );
}
