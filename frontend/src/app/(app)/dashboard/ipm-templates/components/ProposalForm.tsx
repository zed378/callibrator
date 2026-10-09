"use client";

/**
 * P22-01 — a tenant's catalogue proposal (P19-01 spec § 7.4): a new device type, or items to add,
 * change or retire on a type's checklist, with the reason. A change or a retirement names the item
 * it is about, chosen from the checklist the type currently uses. Nothing written here enters the
 * global catalogue: the platform operator reads it and edits a draft by hand.
 */
import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { resolveTemplateVersion, TEMPLATE_PROPOSAL_KINDS, type TemplateProposalKind } from "@callibrator/contracts/inspectionValues";
import { Button, Input, Textarea } from "@/components/ui";
import type { CreateProposalBody, ProposalItemInput, PublishedCatalogue } from "@/api/services/ipmCatalogue.service";
import { INSPECTION_SECTIONS, INSPECTION_SECTION_RULES, LIMIT_KINDS, MEASURED_KINDS, orderedItems, type InspectionInputKind, type InspectionSection } from "../catalogue";
import { FIELD, useCatalogueText } from "./shared";

interface ItemRow {
  itemDefinitionId: string;
  section: InspectionSection;
  inputKind: InspectionInputKind;
  label: string;
  unit: string;
  limitText: string;
  note: string;
}

const blankRow = (): ItemRow => ({ itemDefinitionId: "", section: "function", inputKind: "tri_state", label: "", unit: "", limitText: "", note: "" });
const orNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

interface Props {
  catalogue: PublishedCatalogue;
  busy: boolean;
  onSubmit: (body: CreateProposalBody) => void;
  onCancel: () => void;
}

export function ProposalForm({ catalogue, busy, onSubmit, onCancel }: Props) {
  const text = useCatalogueText();
  const { t } = text;
  const [kind, setKind] = useState<TemplateProposalKind>("add_items");
  const [typeId, setTypeId] = useState("");
  const [newName, setNewName] = useState("");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<ItemRow[]>([blankRow()]);

  const isNew = kind === "new_device_type";
  const namesItem = kind === "change_items" || kind === "retire_items";
  const version = typeId ? resolveTemplateVersion(catalogue.versions, typeId) : null;
  const existing = version ? orderedItems(version.items) : [];

  const setRow = (index: number, patch: Partial<ItemRow>) => setItems((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const pickExisting = (index: number, definitionId: string) => {
    const item = existing.find((i) => i.itemDefinitionId === definitionId);
    setRow(
      index,
      item
        ? { itemDefinitionId: item.itemDefinitionId, section: item.section, inputKind: item.inputKind, label: item.label, unit: item.unit ?? "", limitText: item.limitText ?? "" }
        : { itemDefinitionId: "" },
    );
  };

  const rowsComplete = items.every((r) => r.label.trim() !== "" && (!namesItem || r.itemDefinitionId !== ""));
  const itemsNeeded = !isNew;
  const valid =
    reason.trim().length >= 3 &&
    (isNew ? newName.trim() !== "" : typeId !== "") &&
    rowsComplete &&
    (!itemsNeeded || items.length > 0);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const proposedItems: ProposalItemInput[] = items.map((r) => ({
      ...(r.itemDefinitionId ? { itemDefinitionId: r.itemDefinitionId } : {}),
      section: r.section,
      inputKind: r.inputKind,
      label: r.label.trim(),
      unit: MEASURED_KINDS.includes(r.inputKind) ? orNull(r.unit) : null,
      limitText: LIMIT_KINDS.includes(r.inputKind) ? orNull(r.limitText) : null,
      note: orNull(r.note),
    }));
    onSubmit({
      kind,
      ...(isNew ? { proposedDeviceTypeName: newName.trim() } : { deviceTypeId: typeId }),
      ...(!isNew && version ? { basedOnVersionId: version.id } : {}),
      proposedItems,
      reason: reason.trim(),
    });
  };

  return (
    <form className="p-6 space-y-4" onSubmit={submit} noValidate>
      <div className="space-y-1.5">
        <label htmlFor="proposal-kind" className="block text-sm font-semibold">
          {t("ipmCatalogue.proposals.kind")}
        </label>
        <select
          id="proposal-kind"
          className={FIELD}
          value={kind}
          onChange={(e) => {
            const next = e.target.value as TemplateProposalKind;
            setKind(next);
            setItems(next === "new_device_type" ? [] : [blankRow()]);
          }}
        >
          {TEMPLATE_PROPOSAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {text.proposalKind(k)}
            </option>
          ))}
        </select>
      </div>

      {isNew ? (
        <Input label={t("ipmCatalogue.proposals.newTypeName")} required maxLength={255} value={newName} onChange={(e) => setNewName(e.target.value)} />
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="proposal-type" className="block text-sm font-semibold">
            {t("ipmCatalogue.published.deviceType")}
          </label>
          <select id="proposal-type" className={FIELD} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">{t("ipmCatalogue.picker.choose")}</option>
            {catalogue.deviceTypes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t("ipmCatalogue.proposals.items")}</legend>
        {items.length === 0 && <p className="text-sm text-muted-foreground">{t("ipmCatalogue.proposals.noItems")}</p>}
        {items.map((row, index) => {
          const rule = INSPECTION_SECTION_RULES[row.section];
          const n = index + 1;
          return (
            <div key={index} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{t("ipmCatalogue.proposals.itemN", { n })}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t("ipmCatalogue.proposals.removeItemN", { n })}
                  onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              {namesItem && (
                <div className="space-y-1.5">
                  <label htmlFor={`proposal-existing-${n}`} className="block text-sm font-semibold">
                    {t("ipmCatalogue.proposals.existingItem")}
                  </label>
                  <select id={`proposal-existing-${n}`} className={FIELD} value={row.itemDefinitionId} onChange={(e) => pickExisting(index, e.target.value)} disabled={!typeId}>
                    <option value="">{t("ipmCatalogue.picker.choose")}</option>
                    {existing.map((i) => (
                      <option key={i.id} value={i.itemDefinitionId}>
                        {text.section(i.section)} · {i.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {kind !== "retire_items" && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor={`proposal-section-${n}`} className="block text-sm font-semibold">
                        {t("ipmCatalogue.items.section")}
                      </label>
                      <select
                        id={`proposal-section-${n}`}
                        className={FIELD}
                        value={row.section}
                        disabled={namesItem}
                        onChange={(e) => {
                          const section = e.target.value as InspectionSection;
                          setRow(index, { section, inputKind: INSPECTION_SECTION_RULES[section].inputKinds[0] as InspectionInputKind });
                        }}
                      >
                        {INSPECTION_SECTIONS.map((s) => (
                          <option key={s} value={s}>
                            {text.section(s)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`proposal-kind-${n}`} className="block text-sm font-semibold">
                        {t("ipmCatalogue.items.kind")}
                      </label>
                      <select
                        id={`proposal-kind-${n}`}
                        className={FIELD}
                        value={row.inputKind}
                        disabled={namesItem || rule.inputKinds.length < 2}
                        onChange={(e) => setRow(index, { inputKind: e.target.value as InspectionInputKind })}
                      >
                        {rule.inputKinds.map((k) => (
                          <option key={k} value={k}>
                            {text.kind(k)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <Input id={`proposal-label-${n}`} label={t("ipmCatalogue.items.label")} required maxLength={255} value={row.label} onChange={(e) => setRow(index, { label: e.target.value })} />
                  {MEASURED_KINDS.includes(row.inputKind) && (
                    <Input id={`proposal-unit-${n}`} label={t("ipmCatalogue.items.unit")} maxLength={20} value={row.unit} onChange={(e) => setRow(index, { unit: e.target.value })} />
                  )}
                  {LIMIT_KINDS.includes(row.inputKind) && (
                    <Input id={`proposal-limit-${n}`} label={t("ipmCatalogue.items.limit")} maxLength={100} value={row.limitText} onChange={(e) => setRow(index, { limitText: e.target.value })} />
                  )}
                </>
              )}
              <Input id={`proposal-note-${n}`} label={t("ipmCatalogue.proposals.itemNote")} maxLength={500} value={row.note} onChange={(e) => setRow(index, { note: e.target.value })} />
            </div>
          );
        })}
        <Button type="button" size="sm" variant="outline" leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setItems((rows) => [...rows, blankRow()])}>
          {t("ipmCatalogue.proposals.addItem")}
        </Button>
      </fieldset>

      <Textarea
        label={t("ipmCatalogue.proposals.reason")}
        helperText={t("ipmCatalogue.proposals.reasonHelp")}
        required
        rows={3}
        maxLength={2000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{t("ipmCatalogue.proposals.privacy")}</p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("ipmCatalogue.cancel")}
        </Button>
        <Button type="submit" isLoading={busy} disabled={!valid}>
          {t("ipmCatalogue.proposals.submit")}
        </Button>
      </div>
    </form>
  );
}
