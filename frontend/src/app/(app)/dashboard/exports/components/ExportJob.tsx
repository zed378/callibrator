"use client";

/**
 * P22-06 (`docs/UPSTREAM/09-REPORT-LAYOUTS.md` § 5) — one export's life, the same for every
 * document: **size first** ("check the size": the row count, the requests it takes and an estimate
 * of the file), then **build** with progress ("rows read n / total", "photos n / m", "building the
 * file") and **Cancel**, then the download. Loading, failed and cancelled are said, never shown as
 * an empty file; nothing is uploaded back or stored.
 */
import React, { useEffect, useRef, useState } from "react";
import { Download, Gauge, X } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { ExportCancelled, EXPORT_PAGE_SIZE } from "@/lib/export/pagedRead";
import { useI18n } from "@/i18n/MessagesProvider";

export type Progress = { stage: "rows"; done: number; total: number } | { stage: "photos"; done: number; total: number } | { stage: "building" };

export interface ExportPlan {
  /** The rows the document will hold (one row read). */
  measure: () => Promise<number>;
  /** Reads, builds and downloads; reports its progress; stops when `signal` fires. */
  build: (signal: AbortSignal, progress: (p: Progress) => void) => Promise<void>;
  /** Bytes per row, for the estimate shown first. */
  bytesPerRow: number;
  /** The document's own note under the size (e.g. "photos are off above n rows"). */
  note?: (rows: number) => string | null;
}

type State =
  | { phase: "idle" }
  | { phase: "measuring" }
  | { phase: "measured"; rows: number }
  | { phase: "building"; rows: number; progress: Progress | null }
  | { phase: "done"; rows: number }
  | { phase: "cancelled"; rows: number }
  | { phase: "failed"; rows: number | null; message: string };

/** An estimate as "≈ 1.2 MB" / "≈ 40 KB". */
export const sizeText = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;

interface Props {
  id: string;
  plan: ExportPlan;
  /** The form is incomplete: why (the buttons stay off). */
  blocked: string | null;
  /** A change of the form's choices: the measured size no longer holds. */
  planKey: string;
}

export function ExportJob({ id, plan, blocked, planKey }: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ phase: "idle" });
  const controller = useRef<AbortController | null>(null);
  const [lastKey, setLastKey] = useState(planKey);

  // A changed choice forgets the size measured for the previous one (render-time reset, no effect).
  if (lastKey !== planKey) {
    setLastKey(planKey);
    if (state.phase !== "building") setState({ phase: "idle" });
  }

  useEffect(() => () => controller.current?.abort(), []);

  const measure = async () => {
    setState({ phase: "measuring" });
    try {
      setState({ phase: "measured", rows: await plan.measure() });
    } catch (err) {
      setState({ phase: "failed", rows: null, message: describeApiError(err).message || t("exports.failed") });
    }
  };

  const build = async (rows: number) => {
    const abort = new AbortController();
    controller.current = abort;
    setState({ phase: "building", rows, progress: null });
    try {
      await plan.build(abort.signal, (progress) => setState({ phase: "building", rows, progress }));
      setState({ phase: "done", rows });
    } catch (err) {
      if (err instanceof ExportCancelled) setState({ phase: "cancelled", rows });
      else setState({ phase: "failed", rows, message: describeApiError(err).message || t("exports.failed") });
    } finally {
      controller.current = null;
    }
  };

  const rows = "rows" in state ? state.rows : null;
  const busy = state.phase === "measuring" || state.phase === "building";
  const progressText = (p: Progress | null): string => {
    if (!p) return t("exports.progress.starting");
    if (p.stage === "rows") return t("exports.progress.rows", { done: p.done, total: p.total });
    if (p.stage === "photos") return t("exports.progress.photos", { done: p.done, total: p.total });
    return t("exports.progress.building");
  };

  return (
    <div className="space-y-3">
      {blocked && <p className="text-sm text-muted-foreground">{blocked}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={blocked !== null || busy}
          isLoading={state.phase === "measuring"}
          leftIcon={<Gauge className="h-4 w-4" aria-hidden="true" />}
          onClick={() => void measure()}
        >
          {t("exports.measure")}
        </Button>
        {rows !== null && rows > 0 && state.phase !== "building" && (
          <Button disabled={blocked !== null} leftIcon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void build(rows)}>
            {t("exports.build")}
          </Button>
        )}
        {state.phase === "building" && (
          <Button variant="outline" leftIcon={<X className="h-4 w-4" aria-hidden="true" />} onClick={() => controller.current?.abort()}>
            {t("exports.cancel")}
          </Button>
        )}
      </div>
      <div id={`${id}-status`} role="status" aria-live="polite" className="text-sm space-y-1">
        {state.phase === "measuring" && <p>{t("exports.measuring")}</p>}
        {rows !== null && state.phase !== "failed" && (
          <p>
            {rows === 0
              ? t("exports.empty")
              : t("exports.size", { rows, requests: Math.ceil(rows / EXPORT_PAGE_SIZE), size: sizeText(rows * plan.bytesPerRow + 4096) })}
          </p>
        )}
        {rows !== null && rows > 0 && plan.note?.(rows) && <p className="text-muted-foreground">{plan.note(rows)}</p>}
        {state.phase === "building" && (
          <>
            <p>{progressText(state.progress)}</p>
            {state.progress && state.progress.stage !== "building" && state.progress.total > 0 && (
              <progress className="w-full" max={state.progress.total} value={state.progress.done} aria-label={progressText(state.progress)} />
            )}
          </>
        )}
        {state.phase === "done" && <p>{t("exports.done")}</p>}
        {state.phase === "cancelled" && <p>{t("exports.cancelled")}</p>}
      </div>
      {state.phase === "failed" && (
        <div role="alert">
          <Alert variant="error" title={t("exports.failedTitle")}>
            <p>{state.message}</p>
          </Alert>
        </div>
      )}
    </div>
  );
}
