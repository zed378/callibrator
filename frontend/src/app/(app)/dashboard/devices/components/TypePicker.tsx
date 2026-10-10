"use client";

/**
 * P22-02 (F-31) — the device-type picker: a search box over the global catalogue's ACTIVE types
 * (`GET /device-types?status=active&search=`) and a select of the matches. A device that already
 * holds a type keeps showing it (even retired — the API refuses only GIVING a retired type). A
 * failed read is said, never shown as "no type".
 */
import React, { useEffect, useState } from "react";
import { deviceRegisterService, type DeviceTypeOption } from "@/api/services/deviceRegister.service";
import { FIELD, useDeviceText } from "./shared";

/** How long typing pauses before the search is sent. */
export const SEARCH_DELAY_MS = 250;

interface Props {
  id: string;
  label: string;
  /** The chosen type's id ("" = none). */
  value: string;
  /** The chosen type's name, shown while it is not among the matches. */
  valueName: string;
  onChange: (id: string, name: string) => void;
  /** The label of the "none" option ("No type" in the form, "All types" in a filter). */
  noneLabel: string;
}

export function TypePicker({ id, label, value, valueName, onChange, noneLabel }: Props) {
  const { t } = useDeviceText();
  const [search, setSearch] = useState("");
  const [types, setTypes] = useState<DeviceTypeOption[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    // The read runs from a timer (never in the effect body); an answer after a newer search is dropped.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await deviceRegisterService.deviceTypes(search.trim() || undefined);
          if (active) {
            setTypes(found);
            setFailed(false);
          }
        } catch {
          if (active) {
            setTypes([]);
            setFailed(true);
          }
        }
      })();
    }, search ? SEARCH_DELAY_MS : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search]);

  const options = types ?? [];
  const missing = value !== "" && !options.some((type) => type.id === value);

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-semibold">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          id={`${id}-search`}
          type="search"
          aria-label={t("devices.type.search", { label })}
          placeholder={t("devices.type.searchPlaceholder")}
          className={FIELD}
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          id={id}
          aria-label={label}
          className={FIELD}
          value={value}
          disabled={types === null}
          onChange={(e) => {
            const chosen = options.find((type) => type.id === e.target.value);
            onChange(e.target.value, chosen?.name ?? "");
          }}
        >
          <option value="">{types === null ? t("devices.loading") : noneLabel}</option>
          {missing && <option value={value}>{valueName || value}</option>}
          {options.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          {t("devices.type.failed")}
        </p>
      )}
      {types !== null && !failed && options.length === 0 && <p className="text-xs text-muted-foreground">{t("devices.type.none")}</p>}
    </fieldset>
  );
}
