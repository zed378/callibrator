"use client";

/**
 * P22-04 (F-54, F-56, F-57; P19-02 § 7, § 8) — one IPM visit: its header, its results by section,
 * its lineage (the version it corrects, the correction that replaced it), and what the caller may do.
 *
 *  - an EFFECTIVE visit: start a correction (reason required — the original stays readable and is
 *    superseded only when the correction is submitted); void it (final; unbound only, the server
 *    also requires the tenant administrator role);
 *  - the caller's DRAFT (a correction, or a capture left open): edit the header (date, outcomes,
 *    recommendation, notes — at the revision last read), submit, or discard. The checklist's results
 *    are the IPM capture's (P22-03).
 *
 * Every refusal — a 409 with its code (superseded, voided, a correction already open, a stale
 * revision, missing required items) or a 403 — is shown as the server explained it; the dialog keeps
 * what was typed.
 */
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Dialog, StatusBadge } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { ipmHistoryService, type IpmHeaderBody, type IpmSession } from "@/api/services/ipmHistory.service";
import { deferEffect } from "@/lib/deferEffect";
import { useToastStore } from "@/stores/toastStore";
import { INSPECTION_SECTIONS } from "@callibrator/contracts/inspectionValues";
import {
  REASON_MAX,
  canCorrect,
  canVoid,
  deviceOf,
  facilityOf,
  isDraft,
  localInput,
  measuredText,
  noticesOf,
  reasonValid,
  roomOf,
  stateOf,
  visitLabel,
  type Caller,
  type Recommendation,
} from "../history";
import { FIELD, Field, useIpmText } from "./shared";

type Overall = "" | "pass" | "fail";
type Mode = "view" | "correct" | "void" | "discard";

interface Header {
  performedAt: string;
  inspectionOutcome: Overall;
  maintenanceOutcome: Overall;
  recommendation: "" | Recommendation;
  notes: string;
}

const headerOf = (s: IpmSession): Header => ({
  performedAt: localInput(s.performedAt),
  inspectionOutcome: s.inspectionOutcome ?? "",
  maintenanceOutcome: s.maintenanceOutcome ?? "",
  recommendation: s.recommendation ?? "",
  notes: s.notes ?? "",
});

/** The PATCH body: the revision read, and only what changed. */
export const headerBody = (h: Header, before: Header, revision: number): IpmHeaderBody => {
  const body: IpmHeaderBody = { revision };
  if (h.performedAt !== before.performedAt && h.performedAt) body.performedAt = new Date(h.performedAt).toISOString();
  if (h.inspectionOutcome !== before.inspectionOutcome) body.inspectionOutcome = h.inspectionOutcome || null;
  if (h.maintenanceOutcome !== before.maintenanceOutcome) body.maintenanceOutcome = h.maintenanceOutcome || null;
  if (h.recommendation !== before.recommendation) body.recommendation = h.recommendation || null;
  if (h.notes.trim() !== before.notes.trim()) body.notes = h.notes.trim() === "" ? null : h.notes.trim();
  return body;
};

const RECOMMENDATIONS: Recommendation[] = ["fit_for_use", "needs_calibration", "not_fit_for_use", "needs_repair"];

interface Props {
  sessionId: string;
  caller: Caller;
  /** Closed; `changed` when a write succeeded (the list reloads). */
  onClose: (changed: boolean) => void;
}

export function SessionDialog({ sessionId, caller, onClose }: Props) {
  const text = useIpmText();
  const { t } = text;
  const addToast = useToastStore((s) => s.addToast);
  const [currentId, setCurrentId] = useState(sessionId);
  const [session, setSession] = useState<IpmSession | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [reason, setReason] = useState("");
  const [reasonShown, setReasonShown] = useState(false);
  const [header, setHeader] = useState<Header | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [changed, setChanged] = useState(false);

  const show = (s: IpmSession) => {
    setSession(s);
    setHeader(headerOf(s));
    setMode("view");
    setReason("");
    setReasonShown(false);
  };

  useEffect(
    () =>
      deferEffect(async () => {
        setSession(null);
        setLoadError(null);
        try {
          show(await ipmHistoryService.get(currentId));
        } catch (err) {
          setLoadError(err);
        }
      }),
    [currentId],
  );

  const open = (id: string) => {
    setRefusal(null);
    setNotices([]);
    setCurrentId(id);
  };

  /** One write: busy while it runs, its refusal kept as the server wrote it. */
  const run = async (write: () => Promise<IpmSession>, done: string): Promise<IpmSession | null> => {
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await write();
      setChanged(true);
      setNotices(noticesOf(answer));
      addToast({ type: "success", title: done });
      return answer;
    } catch (err) {
      setRefusal(describeApiError(err).message || t("ipm.refused"));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const close = () => onClose(changed);

  if (!session) {
    return (
      <Dialog isOpen onClose={close} title={t("ipm.session.loadingTitle")} size="xl">
        {loadError === null ? (
          <p className="text-sm text-muted-foreground">{t("ipm.loading")}</p>
        ) : (
          <div role="alert">
            <Alert variant="error" title={t("ipm.session.failed")}>
              <p>{describeApiError(loadError).message}</p>
            </Alert>
          </div>
        )}
      </Dialog>
    );
  }

  const state = stateOf(session);
  const device = session.device ?? deviceOf(session);
  const name = device?.name ?? t("ipm.list.unknownDevice");
  const visit = visitLabel(session.visitNumber);
  const title = visit ? t("ipm.session.title", { visit, name }) : t("ipm.session.titleDraft", { name });
  const draft = isDraft(session) && caller.write && !caller.superAdmin;
  const before = headerOf(session);
  const dirty = header !== null && Object.keys(headerBody(header, before, session.revision)).length > 1;
  const performer = session.performerDisplay;

  const startCorrection = async () => {
    setReasonShown(true);
    if (!reasonValid(reason)) return;
    const draftAnswer = await run(() => ipmHistoryService.correct(session.id, reason.trim()), t("ipm.correct.started"));
    // The correction draft is read back in full (its results copied from the original).
    if (draftAnswer) setCurrentId(draftAnswer.id);
  };

  const voidIt = async () => {
    setReasonShown(true);
    if (!reasonValid(reason)) return;
    const answer = await run(() => ipmHistoryService.voidSession(session.id, reason.trim()), t("ipm.void.done"));
    if (answer) show(answer);
  };

  const saveHeader = async () => {
    if (!header) return;
    const answer = await run(() => ipmHistoryService.editHeader(session.id, headerBody(header, before, session.revision)), t("ipm.draft.saved"));
    if (answer) show(answer);
  };

  const submit = async () => {
    const answer = await run(() => ipmHistoryService.submit(session.id, session.revision), t("ipm.draft.submitted"));
    if (answer) show(answer);
  };

  const discard = async () => {
    const answer = await run(() => ipmHistoryService.discard(session.id, reason.trim() || undefined), t("ipm.draft.discarded"));
    if (answer) show(answer);
  };

  const reasonField = (id: string, label: string, required: boolean) => (
    <Field id={id} label={label} help={required ? t("ipm.reason.help") : undefined}>
      <textarea
        id={id}
        rows={3}
        className={FIELD}
        value={reason}
        maxLength={required ? REASON_MAX : 500}
        aria-describedby={required ? `${id}-help` : undefined}
        aria-invalid={required && reasonShown && !reasonValid(reason) ? true : undefined}
        onChange={(e) => setReason(e.target.value)}
      />
    </Field>
  );

  const sections = INSPECTION_SECTIONS.map((section) => ({ section, rows: session.results.filter((r) => r.section === section) })).filter((g) => g.rows.length > 0);

  return (
    <Dialog isOpen onClose={close} title={title} size="xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge domain="ipmSession" state={state}>
            {text.state(state)}
          </StatusBadge>
          {session.recommendation && (
            <StatusBadge domain="ipmRecommendation" state={session.recommendation}>
              {text.recommendation(session.recommendation)}
            </StatusBadge>
          )}
          {session.capturedOffline && <span className="text-xs text-muted-foreground">{t("ipm.list.offline")}</span>}
        </div>

        {session.supersedesId && (
          <div className="rounded-md border border-border p-3 text-sm space-y-1">
            <p>{t("ipm.session.correctionOf", { reason: session.correctionReason ?? "—" })}</p>
            <Button size="sm" variant="ghost" onClick={() => open(session.supersedesId as string)}>
              {t("ipm.session.openOriginal")}
            </Button>
          </div>
        )}
        {session.supersededById && (
          <div className="rounded-md border border-border p-3 text-sm space-y-1">
            <p>{t("ipm.session.supersededAt", { date: text.when(session.supersededAt) })}</p>
            <Button size="sm" variant="ghost" onClick={() => open(session.supersededById as string)}>
              {t("ipm.session.openLatest")}
            </Button>
          </div>
        )}
        {session.status === "voided" && (
          <p className="rounded-md border border-border p-3 text-sm">{t("ipm.session.voided", { date: text.when(session.voidedAt), reason: session.voidReason ?? "—" })}</p>
        )}
        {session.status === "discarded" && <p className="rounded-md border border-border p-3 text-sm">{t("ipm.session.discarded", { date: text.when(session.discardedAt) })}</p>}

        <section aria-labelledby="ipm-session-header" className="space-y-2">
          <h3 id="ipm-session-header" className="text-base font-semibold">
            {t("ipm.session.header")}
          </h3>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("ipm.col.device")}</dt>
              <dd className="font-medium">
                {name}
                {device?.qrCode && <span className="block font-mono text-xs text-muted-foreground">{device.qrCode}</span>}
                {device?.serialNumber && <span className="block font-mono text-xs text-muted-foreground">{t("ipm.session.serial", { serial: device.serialNumber })}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("ipm.session.performed")}</dt>
              <dd>{text.when(session.performedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("ipm.session.visit")}</dt>
              <dd>
                {visit ?? "—"}
                {session.legacyVisitNumber !== null && <span className="block text-xs text-muted-foreground">{t("ipm.list.legacyVisit", { n: session.legacyVisitNumber })}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("ipm.session.performer")}</dt>
              <dd>{performer?.redacted ? t("ipm.redacted") : (performer?.name ?? "—")}</dd>
            </div>
            {!caller.bound && (
              <div>
                <dt className="text-muted-foreground">{t("ipm.col.facility")}</dt>
                <dd>{facilityOf(session) ?? "—"}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">{t("ipm.col.room")}</dt>
              <dd>{roomOf(session) ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("ipm.session.inspection")}</dt>
              <dd>{text.overall(session.inspectionOutcome)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("ipm.session.maintenance")}</dt>
              <dd>{text.overall(session.maintenanceOutcome)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("ipm.session.recommendation")}</dt>
              <dd>{text.recommendation(session.recommendation)}</dd>
            </div>
            {session.reportNumber && (
              <div>
                <dt className="text-muted-foreground">{t("ipm.session.report")}</dt>
                <dd className="font-mono">{session.reportNumber}</dd>
              </div>
            )}
            {session.templateVersionNumber !== null && (
              <div>
                <dt className="text-muted-foreground">{t("ipm.session.checklistLabel")}</dt>
                <dd>{t("ipm.session.checklist", { n: session.templateVersionNumber })}</dd>
              </div>
            )}
          </dl>
          {session.notes && (
            <div className="text-sm">
              <p className="text-muted-foreground">{t("ipm.session.notes")}</p>
              <p className="whitespace-pre-wrap">{session.notes}</p>
            </div>
          )}
        </section>

        <section aria-labelledby="ipm-session-results" className="space-y-3">
          <h3 id="ipm-session-results" className="text-base font-semibold">
            {t("ipm.results.heading")}
          </h3>
          {sections.length === 0 && <p className="text-sm text-muted-foreground">{t("ipm.results.none")}</p>}
          {sections.map(({ section, rows }) => (
            <div key={section} className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="text-left font-medium py-1">{text.section(section)}</caption>
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-2 py-1 font-medium">
                      {t("ipm.results.item")}
                    </th>
                    <th scope="col" className="px-2 py-1 font-medium">
                      {t("ipm.results.outcome")}
                    </th>
                    <th scope="col" className="px-2 py-1 font-medium">
                      {t("ipm.results.value")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const measured = measuredText(r);
                    return (
                      <tr key={r.id} className="border-b border-border last:border-0 align-top">
                        <th scope="row" className="px-2 py-1 text-left font-normal">
                          {r.label}
                          {r.isAdHoc && <span className="block text-xs text-muted-foreground">{t("ipm.results.adHoc")}</span>}
                        </th>
                        <td className="px-2 py-1">
                          {r.outcome ? text.outcome(r.outcome) : "—"}
                          {r.outcomeSource === "computed" && <span className="block text-xs text-muted-foreground">{t("ipm.results.computed")}</span>}
                          {r.cleanliness && <span className="block text-xs">{text.cleanliness(r.cleanliness)}</span>}
                          {r.warnFlag && <span className="block text-xs text-status-attention">{t("ipm.results.warn")}</span>}
                          {r.disagreementFlag && <span className="block text-xs text-status-attention">{t("ipm.results.disagree")}</span>}
                        </td>
                        <td className="px-2 py-1">
                          {[r.settingText, measured, r.referenceText, r.textValue].filter((v): v is string => typeof v === "string" && v !== "").join(" · ") || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        {draft && header && mode === "view" && (
          <section aria-labelledby="ipm-draft-heading" className="space-y-3 rounded-md border border-border p-4">
            <h3 id="ipm-draft-heading" className="text-base font-semibold">
              {t("ipm.draft.heading")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("ipm.draft.lead")}</p>
            {/* P22-03: the checklist's results are the capture's. */}
            <Link href={`/dashboard/ipm/capture/${session.id}`} className="inline-block text-sm text-primary underline underline-offset-2">
              {t("ipm.capture.continue")}
            </Link>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ipm-performed" label={t("ipm.draft.performedAt")}>
                <input
                  id="ipm-performed"
                  type="datetime-local"
                  className={FIELD}
                  value={header.performedAt}
                  onChange={(e) => setHeader({ ...header, performedAt: e.target.value })}
                />
              </Field>
              <Field id="ipm-recommendation" label={t("ipm.session.recommendation")}>
                <select
                  id="ipm-recommendation"
                  className={FIELD}
                  value={header.recommendation}
                  onChange={(e) => setHeader({ ...header, recommendation: e.target.value as Header["recommendation"] })}
                >
                  <option value="">{t("ipm.recommendation.none")}</option>
                  {RECOMMENDATIONS.map((r) => (
                    <option key={r} value={r}>
                      {text.recommendation(r)}
                    </option>
                  ))}
                </select>
              </Field>
              {(["inspectionOutcome", "maintenanceOutcome"] as const).map((key) => (
                <Field key={key} id={`ipm-${key}`} label={t(key === "inspectionOutcome" ? "ipm.session.inspection" : "ipm.session.maintenance")}>
                  <select id={`ipm-${key}`} className={FIELD} value={header[key]} onChange={(e) => setHeader({ ...header, [key]: e.target.value as Overall })}>
                    <option value="">{t("ipm.overall.unset")}</option>
                    <option value="pass">{text.overall("pass")}</option>
                    <option value="fail">{text.overall("fail")}</option>
                  </select>
                </Field>
              ))}
            </div>
            <Field id="ipm-notes" label={t("ipm.session.notes")}>
              <textarea id="ipm-notes" rows={3} className={FIELD} maxLength={4000} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
            </Field>
            {dirty && <p className="text-xs text-muted-foreground">{t("ipm.draft.unsaved")}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!dirty || busy} isLoading={busy && dirty} onClick={() => void saveHeader()}>
                {t("ipm.draft.save")}
              </Button>
              <Button disabled={dirty || busy} isLoading={busy && !dirty} onClick={() => void submit()}>
                {t("ipm.draft.submit")}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setRefusal(null);
                  setReason("");
                  setMode("discard");
                }}
              >
                {t("ipm.draft.discard")}
              </Button>
            </div>
          </section>
        )}

        {mode === "correct" && (
          <section aria-labelledby="ipm-correct-heading" className="space-y-3 rounded-md border border-border p-4">
            <h3 id="ipm-correct-heading" className="text-base font-semibold">
              {t("ipm.correct.title")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("ipm.correct.lead")}</p>
            {reasonField("ipm-correct-reason", t("ipm.correct.reason"), true)}
            {reasonShown && !reasonValid(reason) && <p className="text-sm text-destructive">{t("ipm.reason.invalid")}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setMode("view")}>
                {t("ipm.cancel")}
              </Button>
              <Button isLoading={busy} onClick={() => void startCorrection()}>
                {t("ipm.correct.confirm")}
              </Button>
            </div>
          </section>
        )}

        {mode === "void" && (
          <section aria-labelledby="ipm-void-heading" className="space-y-3 rounded-md border border-destructive/40 p-4">
            <h3 id="ipm-void-heading" className="text-base font-semibold">
              {t("ipm.void.title")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("ipm.void.lead")}</p>
            {reasonField("ipm-void-reason", t("ipm.void.reason"), true)}
            {reasonShown && !reasonValid(reason) && <p className="text-sm text-destructive">{t("ipm.reason.invalid")}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setMode("view")}>
                {t("ipm.cancel")}
              </Button>
              <Button variant="danger" isLoading={busy} onClick={() => void voidIt()}>
                {t("ipm.void.confirm")}
              </Button>
            </div>
          </section>
        )}

        {mode === "discard" && (
          <section aria-labelledby="ipm-discard-heading" className="space-y-3 rounded-md border border-border p-4">
            <h3 id="ipm-discard-heading" className="text-base font-semibold">
              {t("ipm.draft.discardTitle")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("ipm.draft.discardLead")}</p>
            {reasonField("ipm-discard-reason", t("ipm.draft.discardReason"), false)}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setMode("view")}>
                {t("ipm.cancel")}
              </Button>
              <Button variant="danger" isLoading={busy} onClick={() => void discard()}>
                {t("ipm.draft.discardConfirm")}
              </Button>
            </div>
          </section>
        )}

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
        {refusal && (
          <div role="alert">
            <Alert variant="error" title={t("ipm.refused")}>
              <p>{refusal}</p>
            </Alert>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {mode === "view" && canCorrect(session, caller) && (
            <Button
              variant="outline"
              onClick={() => {
                setRefusal(null);
                setReason("");
                setReasonShown(false);
                setMode("correct");
              }}
            >
              {t("ipm.correct.button")}
            </Button>
          )}
          {mode === "view" && canVoid(session, caller) && (
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => {
                setRefusal(null);
                setReason("");
                setReasonShown(false);
                setMode("void");
              }}
            >
              {t("ipm.void.button")}
            </Button>
          )}
          <Button variant="outline" onClick={close}>
            {t("ipm.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
