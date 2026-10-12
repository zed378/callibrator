"use client";
/**
 * P22-10c2 — Outbox / Needs attention (P19-08 § 9.6): every capture this phone holds, its state,
 * and — when the server refused it — the server's own words beside a localised explanation keyed by
 * the answer's top-level `code`, with the actions that code allows. Nothing is dropped without a
 * confirmed action: a discard needs DISCARD typed.
 */
import React, { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { AttentionAction } from "../../engine/engine";
import type { Attention, Capture } from "../../engine/model";
import { ScreenTitle } from "../FieldApp";
import { useField, useFieldStoreApi, useFieldText } from "../context";
import { FIELD_INPUT, ScreenLink } from "./common";

/** The codes with their own explanation (`field.conflict.<CODE>`). */
export const EXPLAINED_CODES = [
  "IPM_DEVICE_RETIRED",
  "IPM_DEVICE_INACTIVE",
  "IPM_FACILITY_ENDED",
  "DEVICE_FACILITY_ENDED",
  "IPM_DRAFT_EXISTS",
  "IPM_REVISION_CONFLICT",
  "IPM_NOT_DRAFT",
  "IPM_VOIDED",
  "IPM_SUPERSEDED",
  "IPM_ORIGINAL_NOT_EFFECTIVE",
  "IPM_NO_CHECKLIST",
  "IPM_VERSION_RETIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_SCOPE_CHANGED",
  "DEVICE_QR_TAKEN",
] as const;

/** The explanation's key for an answer (P19-08 § 9.6). */
export const explanationOf = (a: Attention): string => {
  if (a.code && (EXPLAINED_CODES as readonly string[]).includes(a.code)) return `field.conflict.${a.code}`;
  if (a.status === 404) return "field.conflict.notFound";
  if (a.status === 403) return "field.conflict.forbidden";
  if (a.status === 413 || a.status === 415) return "field.conflict.photo";
  if (a.status === 400) return "field.conflict.invalid";
  return "field.conflict.other";
};

/** The actions an answer allows, besides discarding (always possible, confirmed). */
export const actionsOf = (a: Attention): AttentionAction[] => {
  switch (a.code) {
    case "IPM_DRAFT_EXISTS":
      return ["use_server_draft"];
    case "IPM_REVISION_CONFLICT":
      return ["keep_mine"];
    case "IDEMPOTENCY_SCOPE_CHANGED":
    case "IDEMPOTENCY_KEY_REUSED":
      return ["retry"];
    default:
      if (a.status === 400) return ["edit"];
      if (a.status === 413 || a.status === 415) return ["edit"];
      return a.status >= 500 || a.status === 0 ? ["retry"] : [];
  }
};

export function OutboxScreen() {
  const { t } = useFieldText();
  const captures = useField((s) => s.captures);
  return (
    <section className="space-y-4">
      <ScreenTitle>{t("field.outbox.title")}</ScreenTitle>
      {captures.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("field.outbox.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {captures.map((c) => (
            <li key={c.localId}>
              <Row capture={c} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ capture }: { capture: Capture }) {
  const { t, tk, when } = useFieldText();
  const api = useFieldStoreApi();
  const name = useField((s) => (capture.deviceId ? (s.index.byId(capture.deviceId)?.name ?? null) : null));
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const label = capture.kind === "device" ? String(capture.device?.["name"] ?? t("field.outbox.newDevice")) : (name ?? t("field.outbox.ipm"));
  const a = capture.attention;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {capture.kind === "device" ? t("field.outbox.kindDevice") : t("field.outbox.kindIpm")}: {label}
          </p>
          <StatusBadge domain="fieldCapture" state={capture.state}>
            {tk(`field.state.${capture.state}`)}
          </StatusBadge>
        </div>
        <p className="text-xs text-muted-foreground">{t("field.outbox.captured", { time: when(capture.clientCapturedAt) })}</p>
        {capture.dependsOn && capture.confirmed.id === null && <p className="text-xs text-muted-foreground">{t("field.outbox.waitsForDevice")}</p>}
        {a && (
          <Alert variant="warning" title={tk(explanationOf(a))}>
            {a.message && <p className="text-sm">{t("field.outbox.server", { message: a.message })}</p>}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          {capture.kind === "ipm" && capture.state === "editing" && (
            <ScreenLink view="capture" refId={capture.localId}>
              {t("field.outbox.continue")}
            </ScreenLink>
          )}
          {a &&
            actionsOf(a).map((action) => (
              <Button key={action} variant="outline" onClick={() => void api.getState().resolve(capture.localId, action)}>
                {tk(`field.action.${action}`)}
              </Button>
            ))}
          {capture.state !== "synced" && capture.state !== "discarded_local" && (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t("field.outbox.discard")}
            </Button>
          )}
        </div>
        {confirming && (
          <div className="space-y-2">
            <label htmlFor={`field-discard-${capture.localId}`} className="block text-sm font-semibold">
              {t("field.outbox.discardConfirm")}
            </label>
            <input id={`field-discard-${capture.localId}`} className={FIELD_INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <Button
              variant="danger"
              disabled={typed !== "DISCARD"}
              onClick={() => void (a ? api.getState().resolve(capture.localId, "discard") : api.getState().discard(capture.localId))}
            >
              {t("field.outbox.discardNow")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
