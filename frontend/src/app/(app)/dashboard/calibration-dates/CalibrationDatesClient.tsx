"use client";

/**
 * P22-05 — calibration dates (/dashboard/calibration-dates; F-62, F-63; P19-05 spec § 7, § 8).
 *
 * What a caller sees is decided by the SAME effective permissions the API gates read (ADR-102;
 * never a role name):
 *  - "Record a date": `calibration` write, and neither a facility-bound account (the route is not
 *    facility-accessible, N-10: 403) nor the platform operator (the platform tenant authors nothing,
 *    A-127: 403);
 *  - "Calibration list": `calibration` read — a facility-bound reader reads its facility's records
 *    (the server scopes them), without the facility filter.
 *  - the laboratory picker: `vendors` read; otherwise the device's own laboratory or a typed name.
 *
 * Bilingual (Indonesian default, English): every string is the `calibrationDates.` namespace the
 * server page hands this island.
 */
import React, { useState } from "react";
import { CalendarCheck, Shield } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { usePermissions, type Permissions } from "@/hooks/usePermissions";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import { QuickEntryPanel } from "./components/QuickEntryPanel";
import { CalibrationListPanel } from "./components/CalibrationListPanel";

type Tab = "entry" | "list";

/** The tabs a caller sees, in order. */
export const tabsFor = (p: Pick<Permissions, "superAdmin" | "facilityBound" | "canRead" | "canWrite">): Tab[] => {
  const tabs: Tab[] = [];
  if (p.canWrite("calibration") && !p.facilityBound && !p.superAdmin) tabs.push("entry");
  if (p.canRead("calibration")) tabs.push("list");
  return tabs;
};

export function CalibrationDatesClient({ languageForm }: { languageForm?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const permissions = usePermissions();
  const tabs = tabsFor(permissions);
  const [chosen, setChosen] = useState<Tab | null>(null);
  const tab = chosen !== null && tabs.includes(chosen) ? chosen : tabs[0];

  if (!permissions.loaded) {
    return (
      <DashboardLayout>
        <div lang={locale}>
          <h1 className="sr-only">{t("calibrationDates.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("calibrationDates.loading")}</p>
        </div>
      </DashboardLayout>
    );
  }

  if (tab === undefined) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center" lang={locale}>
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">{t("calibrationDates.title")}</h1>
          <p className="text-muted-foreground">{t("calibrationDates.restricted")}</p>
        </div>
      </DashboardLayout>
    );
  }

  const onKey = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length] as Tab;
    setChosen(next);
    document.getElementById(`caldates-tab-${next}`)?.focus();
  };

  const showFacility = !permissions.facilityBound;

  return (
    <DashboardLayout>
      <div className="space-y-6" lang={locale}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <CalendarCheck className="w-6 h-6 text-primary" aria-hidden="true" />
              {t("calibrationDates.title")}
            </h1>
            <p className="text-sm text-muted-foreground max-w-3xl">{t("calibrationDates.lead")}</p>
          </div>
          {languageForm}
        </div>

        {tabs.length > 1 && (
          <div role="tablist" aria-label={t("calibrationDates.tabs")} className="flex flex-wrap gap-2">
            {tabs.map((name, index) => (
              <button
                key={name}
                id={`caldates-tab-${name}`}
                type="button"
                role="tab"
                aria-selected={tab === name}
                aria-controls="caldates-tabpanel"
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setChosen(name)}
                onKeyDown={(e) => onKey(e, index)}
                className={`min-h-9 px-3 py-1.5 rounded-md text-sm border ${
                  tab === name ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:bg-muted"
                }`}
              >
                {t(`calibrationDates.tab.${name}` as MessageKey)}
              </button>
            ))}
          </div>
        )}

        <div
          id="caldates-tabpanel"
          role={tabs.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={tabs.length > 1 ? `caldates-tab-${tab}` : undefined}
        >
          {tab === "entry" && <QuickEntryPanel canPickLab={permissions.canRead("vendors")} showFacility={showFacility} />}
          {tab === "list" && <CalibrationListPanel showFacility={showFacility} />}
        </div>
      </div>
    </DashboardLayout>
  );
}
