"use client";

/**
 * P22-01 — choose an active device type by name (F-31's picker, operator side): a search box over
 * `GET /device-types?search=` and the matches as a list to choose from. Debounced; a failed search
 * says so instead of showing no matches.
 */
import React, { useEffect, useState } from "react";
import { ipmCatalogueService, type DeviceType } from "@/api/services/ipmCatalogue.service";
import { FIELD, useCatalogueText } from "./shared";

const DEBOUNCE_MS = 250;
const MATCHES = 50;

interface Props {
  id: string;
  label: string;
  value: DeviceType | null;
  onChange: (type: DeviceType | null) => void;
}

export function DeviceTypePicker({ id, label, value, onChange }: Props) {
  const { t } = useCatalogueText();
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<DeviceType[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const term = search.trim();
      ipmCatalogueService
        .listDeviceTypes({ status: "active", limit: MATCHES, ...(term ? { search: term } : {}) })
        .then((page) => {
          if (!live) return;
          setMatches(page.rows);
          setFailed(false);
        })
        .catch(() => {
          if (!live) return;
          setMatches([]);
          setFailed(true);
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search]);

  const options = value && !matches.some((m) => m.id === value.id) ? [value, ...matches] : matches;

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <label htmlFor={`${id}-search`} className="block text-sm font-semibold">
          {t("ipmCatalogue.picker.search", { label })}
        </label>
        <input id={`${id}-search`} className={FIELD} maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-semibold">
          {label}
        </label>
        <select
          id={id}
          className={FIELD}
          value={value?.id ?? ""}
          onChange={(e) => onChange(options.find((o) => o.id === e.target.value) ?? null)}
        >
          <option value="">{t("ipmCatalogue.picker.choose")}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {failed && (
          <p role="alert" className="text-xs text-destructive">
            {t("ipmCatalogue.picker.failed")}
          </p>
        )}
      </div>
    </div>
  );
}
