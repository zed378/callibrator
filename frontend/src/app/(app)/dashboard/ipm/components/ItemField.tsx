"use client";

/**
 * P22-03 — one checklist item (or ad-hoc row) as the technician answers it, by its input kind
 * (P19-01 § 5): a check, a tri-state, condition + cleanliness, a reading (or "not applicable"), a
 * reading against its limit (the computed outcome shown as it will be stored — never overridable
 * when determinate), a setting with two readings and a reference, or a text. Touch-sized controls
 * (mobile first), every control named after its item; the server's own rule's problem is shown
 * on the field as it is typed (`checkAnswer`).
 */
import React from "react";
import { checkAnswer, outcomesOf, type AdHocRow, type Answer, type TemplateItem } from "../capture";
import { FIELD, useIpmText } from "./shared";

interface Props {
  id: string;
  item: TemplateItem | AdHocRow;
  answer: Answer;
  onChange: (patch: Partial<Answer>) => void;
  /** An ad-hoc row's own label, unit, setting and reference fields, and its removal. */
  adHoc?: { onEdit: (patch: Partial<Pick<AdHocRow, "label" | "unit" | "settingText" | "referenceText">>) => void; onRemove: () => void };
}

const CHOICE = "min-h-11 rounded-md border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary";

function Choices({ name, options, value, onPick, label }: { name: string; options: readonly string[]; value: string | null; onPick: (v: string | null) => void; label: (v: string) => string }) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          className={`${CHOICE} ${value === o ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted"}`}
          onClick={() => onPick(value === o ? null : o)}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

export function ItemField({ id, item, answer, onChange, adHoc }: Props) {
  const text = useIpmText();
  const { t } = text;
  const isItem = "itemDefinitionId" in item;
  const name = item.label || t("ipm.capture.adHoc.unnamed");
  const checked = checkAnswer(item, answer);
  const problem = checked.ok ? null : checked.problem;
  const computed = checked.ok ? checked.result.computedOutcome : null;
  const outcomes = outcomesOf(item);
  const unit = isItem ? item.unit : item.unit || null;
  const required = isItem && item.required;

  const reading = (key: "value" | "value1" | "value2", label: string) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${key}`} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`${id}-${key}`}
          inputMode="decimal"
          autoComplete="off"
          className={`${FIELD} min-h-11 max-w-40`}
          value={answer[key]}
          disabled={answer.notApplicable}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          onChange={(e) => onChange({ [key]: e.target.value })}
        />
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );

  const notApplicable = (
    <label className="inline-flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" checked={answer.notApplicable} onChange={(e) => onChange({ notApplicable: e.target.checked, ...(e.target.checked ? { value: "", outcome: null } : {}) })} />
      {t("ipm.capture.notApplicable")}
    </label>
  );

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      {adHoc ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor={`${id}-label`} className="block text-sm font-semibold">
              {t("ipm.capture.adHoc.label")}
            </label>
            <input id={`${id}-label`} className={`${FIELD} min-h-11`} maxLength={255} value={item.label} onChange={(e) => adHoc.onEdit({ label: e.target.value })} />
          </div>
          {item.inputKind === "measured_with_limit" && (
            <div className="space-y-1">
              <label htmlFor={`${id}-unit`} className="block text-xs text-muted-foreground">
                {t("ipm.capture.adHoc.unit")}
              </label>
              <input id={`${id}-unit`} className={`${FIELD} min-h-11`} maxLength={20} value={(item as AdHocRow).unit} onChange={(e) => adHoc.onEdit({ unit: e.target.value })} />
            </div>
          )}
          {item.inputKind === "setting_measured_reference" && (
            <>
              <div className="space-y-1">
                <label htmlFor={`${id}-setting`} className="block text-xs text-muted-foreground">
                  {t("ipm.capture.setting")}
                </label>
                <input id={`${id}-setting`} className={`${FIELD} min-h-11`} maxLength={50} value={(item as AdHocRow).settingText} onChange={(e) => adHoc.onEdit({ settingText: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-reference`} className="block text-xs text-muted-foreground">
                  {t("ipm.capture.reference")}
                </label>
                <input id={`${id}-reference`} className={`${FIELD} min-h-11`} maxLength={100} value={(item as AdHocRow).referenceText} onChange={(e) => adHoc.onEdit({ referenceText: e.target.value })} />
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-sm font-semibold">
          {name}
          {required && <span className="ml-1 text-xs font-normal text-muted-foreground">{t("ipm.capture.required")}</span>}
        </p>
      )}

      {isItem && (item.settingText || item.limitText) && (
        <p className="text-xs text-muted-foreground">
          {[item.settingText ? t("ipm.capture.settingIs", { value: item.settingText }) : null, item.limitText ? t("ipm.capture.limitIs", { value: item.limitText }) : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {(item.inputKind === "check" || item.inputKind === "tri_state") && (
        <Choices name={name} options={outcomes} value={answer.outcome} onPick={(v) => onChange({ outcome: v as Answer["outcome"] })} label={text.outcome} />
      )}

      {item.inputKind === "condition_clean" && (
        <div className="space-y-2">
          <Choices name={name} options={outcomes} value={answer.outcome} onPick={(v) => onChange({ outcome: v as Answer["outcome"] })} label={text.outcome} />
          <Choices
            name={t("ipm.capture.cleanlinessOf", { name })}
            options={["clean", "dirty"]}
            value={answer.cleanliness}
            onPick={(v) => onChange({ cleanliness: v as Answer["cleanliness"] })}
            label={text.cleanliness}
          />
        </div>
      )}

      {item.inputKind === "measured" && (
        <div className="flex flex-wrap items-end gap-3">
          {reading("value", t("ipm.capture.reading"))}
          {outcomes.includes("not_applicable") && notApplicable}
        </div>
      )}

      {item.inputKind === "measured_with_limit" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            {reading("value", t("ipm.capture.reading"))}
            {outcomes.includes("not_applicable") && notApplicable}
          </div>
          {computed ? (
            <p className="text-sm">{t("ipm.capture.computed", { outcome: text.outcome(computed) })}</p>
          ) : (
            !answer.notApplicable && (
              <Choices
                name={t("ipm.capture.outcomeOf", { name })}
                options={outcomes.filter((o) => o !== "not_applicable")}
                value={answer.outcome}
                onPick={(v) => onChange({ outcome: v as Answer["outcome"] })}
                label={text.outcome}
              />
            )
          )}
        </div>
      )}

      {item.inputKind === "setting_measured_reference" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            {reading("value1", t("ipm.capture.reading1"))}
            {reading("value2", t("ipm.capture.reading2"))}
          </div>
          {!isItem && (item as AdHocRow).referenceText && <p className="text-xs text-muted-foreground">{t("ipm.capture.referenceIs", { value: (item as AdHocRow).referenceText })}</p>}
          <Choices name={t("ipm.capture.outcomeOf", { name })} options={outcomes} value={answer.outcome} onPick={(v) => onChange({ outcome: v as Answer["outcome"] })} label={text.outcome} />
          {computed && answer.outcome && computed !== answer.outcome && <p className="text-xs text-status-attention">{t("ipm.capture.disagree", { outcome: text.outcome(computed) })}</p>}
        </div>
      )}

      {item.inputKind === "text" && (
        <div className="space-y-1">
          <label htmlFor={`${id}-text`} className="sr-only">
            {name}
          </label>
          <textarea id={`${id}-text`} rows={2} className={FIELD} maxLength={500} value={answer.text} onChange={(e) => onChange({ text: e.target.value })} />
        </div>
      )}

      {checked.ok && checked.result.warnFlag && <p className="text-xs text-status-attention">{t("ipm.results.warn")}</p>}
      {problem && (
        <p id={`${id}-problem`} className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {adHoc && (
        <button type="button" className="min-h-11 text-sm text-destructive underline underline-offset-2" onClick={adHoc.onRemove}>
          {t("ipm.capture.adHoc.remove", { name })}
        </button>
      )}
    </div>
  );
}
