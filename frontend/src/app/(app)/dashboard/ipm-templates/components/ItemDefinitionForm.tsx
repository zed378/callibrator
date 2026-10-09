"use client";

/**
 * P22-01 — one library item, created or edited (operator). The section decides which input kinds
 * and outcomes are offered (`INSPECTION_SECTION_RULES`); the kind decides which fields show. The
 * limit is written as text and previewed as the server will read it (`parseLimit`); a limit the
 * grammar does not cover is kept as text and only printed. The shared content checks run as the
 * operator types; the server runs them again and its 400 is shown as written.
 *
 * An edit keeps the section and the kind (the API refuses a change of either).
 */
import React, { useState } from "react";
import { Button, Input, Textarea } from "@/components/ui";
import type { ItemDefinition } from "@/api/services/ipmCatalogue.service";
import {
  INSPECTION_SECTIONS,
  INSPECTION_SECTION_RULES,
  LIMIT_KINDS,
  MEASURED_KINDS,
  contentProblems,
  limitPreview,
  limitSymbolic,
  type ContentFields,
  type InspectionInputKind,
  type InspectionSection,
} from "../catalogue";
import { FIELD, useCatalogueText } from "./shared";

/** What the form hands back: the content, whether the item is required by default, the operator's notes. */
export interface ItemDefinitionDraft {
  content: ContentFields;
  defaultRequired: boolean;
  notes: string | null;
}

const blank = (section: InspectionSection): ContentFields => {
  const rule = INSPECTION_SECTION_RULES[section];
  return {
    section,
    label: "",
    inputKind: rule.inputKinds[0] as InspectionInputKind,
    unit: null,
    symbol: null,
    settingText: null,
    settingValue: null,
    limitText: null,
    validMin: null,
    validMax: null,
    warnMin: null,
    warnMax: null,
    allowedOutcomes: [...rule.outcomes],
  };
};

interface Props {
  /** The definition being edited; absent for a new one. */
  editing?: ItemDefinition;
  busy: boolean;
  onSubmit: (draft: ItemDefinitionDraft) => void;
  onCancel: () => void;
}

export function ItemDefinitionForm({ editing, busy, onSubmit, onCancel }: Props) {
  const text = useCatalogueText();
  const { t } = text;
  const [content, setContent] = useState<ContentFields>(() => (editing ? { ...editing } : blank("function")));
  const [defaultRequired, setDefaultRequired] = useState(editing?.defaultRequired ?? true);
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const rule = INSPECTION_SECTION_RULES[content.section];
  const measured = MEASURED_KINDS.includes(content.inputKind);
  const hasLimit = LIMIT_KINDS.includes(content.inputKind);
  const hasOutcomes = content.inputKind !== "text" && rule.outcomes.length > 0;
  const problems = contentProblems(content);
  const limit = limitPreview(content.limitText);
  const symbolic = limitSymbolic(content.limitText);

  const set = <K extends keyof ContentFields>(key: K, value: ContentFields[K]) => setContent((c) => ({ ...c, [key]: value }));
  const nullable = (value: string): string | null => (value.trim() === "" ? null : value);

  const changeSection = (section: InspectionSection) => setContent((c) => ({ ...blank(section), label: c.label, symbol: c.symbol }));

  const toggleOutcome = (outcome: (typeof rule.outcomes)[number]) =>
    setContent((c) => ({
      ...c,
      allowedOutcomes: c.allowedOutcomes.includes(outcome) ? c.allowedOutcomes.filter((o) => o !== outcome) : rule.outcomes.filter((o) => o === outcome || c.allowedOutcomes.includes(o)),
    }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (content.label.trim() === "" || problems.length > 0) return;
    onSubmit({ content, defaultRequired, notes: notes.trim() === "" ? null : notes.trim() });
  };

  return (
    <form className="p-6 space-y-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="item-section" className="block text-sm font-semibold">
            {t("ipmCatalogue.items.section")}
          </label>
          <select
            id="item-section"
            className={FIELD}
            value={content.section}
            disabled={editing !== undefined}
            onChange={(e) => changeSection(e.target.value as InspectionSection)}
          >
            {INSPECTION_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {text.section(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="item-kind" className="block text-sm font-semibold">
            {t("ipmCatalogue.items.kind")}
          </label>
          <select
            id="item-kind"
            className={FIELD}
            value={content.inputKind}
            disabled={editing !== undefined || rule.inputKinds.length < 2}
            onChange={(e) => set("inputKind", e.target.value as InspectionInputKind)}
          >
            {rule.inputKinds.map((k) => (
              <option key={k} value={k}>
                {text.kind(k)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {editing !== undefined && <p className="text-xs text-muted-foreground">{t("ipmCatalogue.library.lockedKind")}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Input label={t("ipmCatalogue.items.label")} required maxLength={255} value={content.label} onChange={(e) => set("label", e.target.value)} />
        </div>
        <Input label={t("ipmCatalogue.items.symbol")} maxLength={50} value={content.symbol ?? ""} onChange={(e) => set("symbol", nullable(e.target.value))} />
      </div>

      {measured && (
        <Input
          label={t("ipmCatalogue.items.unit")}
          required
          maxLength={20}
          value={content.unit ?? ""}
          helperText={t("ipmCatalogue.library.unitHelp")}
          onChange={(e) => set("unit", nullable(e.target.value))}
        />
      )}

      {content.inputKind === "setting_measured_reference" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t("ipmCatalogue.items.setting")} maxLength={50} value={content.settingText ?? ""} onChange={(e) => set("settingText", nullable(e.target.value))} />
          <Input
            label={t("ipmCatalogue.items.settingValue")}
            inputMode="decimal"
            value={content.settingValue ?? ""}
            onChange={(e) => set("settingValue", nullable(e.target.value))}
          />
        </div>
      )}

      {hasLimit && (
        <div className="space-y-1.5">
          <Input
            label={t("ipmCatalogue.items.limit")}
            maxLength={100}
            value={content.limitText ?? ""}
            helperText={t("ipmCatalogue.library.limitHelp")}
            onChange={(e) => set("limitText", nullable(e.target.value))}
          />
          {limit !== null && (
            <p className="text-sm" aria-live="polite">
              {symbolic !== null ? t("ipmCatalogue.library.limitReadAs", { limit: symbolic }) : t("ipmCatalogue.library.limitAsText")}
            </p>
          )}
        </div>
      )}

      {measured && (
        <fieldset className="grid gap-4 sm:grid-cols-4">
          <legend className="text-sm font-semibold mb-2">{t("ipmCatalogue.library.ranges")}</legend>
          <Input label={t("ipmCatalogue.items.validMin")} inputMode="decimal" value={content.validMin ?? ""} onChange={(e) => set("validMin", nullable(e.target.value))} />
          <Input label={t("ipmCatalogue.items.validMax")} inputMode="decimal" value={content.validMax ?? ""} onChange={(e) => set("validMax", nullable(e.target.value))} />
          <Input label={t("ipmCatalogue.items.warnMin")} inputMode="decimal" value={content.warnMin ?? ""} onChange={(e) => set("warnMin", nullable(e.target.value))} />
          <Input label={t("ipmCatalogue.items.warnMax")} inputMode="decimal" value={content.warnMax ?? ""} onChange={(e) => set("warnMax", nullable(e.target.value))} />
        </fieldset>
      )}

      {hasOutcomes && (
        <fieldset>
          <legend className="text-sm font-semibold mb-2">{t("ipmCatalogue.items.outcomes")}</legend>
          <div className="flex flex-wrap gap-4">
            {rule.outcomes.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={content.allowedOutcomes.includes(o)} onChange={() => toggleOutcome(o)} />
                {text.outcome(o)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={defaultRequired} onChange={(e) => setDefaultRequired(e.target.checked)} />
        {t("ipmCatalogue.library.defaultRequired")}
      </label>

      <Textarea label={t("ipmCatalogue.library.notes")} helperText={t("ipmCatalogue.library.notesHelp")} maxLength={2000} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />

      {problems.length > 0 && (
        <div role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
          <p className="font-semibold">{t("ipmCatalogue.library.problems")}</p>
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("ipmCatalogue.cancel")}
        </Button>
        <Button type="submit" isLoading={busy} disabled={content.label.trim() === "" || problems.length > 0}>
          {editing ? t("ipmCatalogue.save") : t("ipmCatalogue.library.add")}
        </Button>
      </div>
    </form>
  );
}
