"use client";

/**
 * P22-01 — the IPM checklist catalogue (/dashboard/ipm-templates; F-22; P19-01 spec; ADR-125).
 *
 * Two audiences, decided by the SAME effective permissions the API gates read (ADR-102; never a
 * role name):
 *  - the platform operator (super admin): the checklists and their drafts, the item library, the
 *    device types, the proposal queue — every catalogue write is `superAdminOnly` on the API — and
 *    the published catalogue;
 *  - everyone else with a catalogue read (`ipm-templates`, `ipm` or `calibration`): the published
 *    catalogue, read-only; with `ipm-templates` read, the tenant's proposals (write to propose and
 *    withdraw). A facility-bound account never gets the proposals (its routes refuse it, G-P8).
 *
 * Bilingual (Indonesian default, English): every string is the `ipmCatalogue.` namespace the server
 * page hands this island.
 */
import React, { useState } from "react";
import { ClipboardList, Shield } from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { usePermissions } from "@/hooks/usePermissions";
import { useI18n } from "@/i18n/MessagesProvider";
import type { MessageKey } from "@/i18n";
import { DeviceTypesPanel } from "./components/DeviceTypesPanel";
import { ItemLibraryPanel } from "./components/ItemLibraryPanel";
import { ProposalQueuePanel } from "./components/ProposalQueuePanel";
import { ProposalsPanel } from "./components/ProposalsPanel";
import { PublishedCataloguePanel } from "./components/PublishedCataloguePanel";
import { TemplatesPanel } from "./components/TemplatesPanel";

type Tab = "checklists" | "library" | "types" | "queue" | "published" | "proposals";

/** The slugs whose read opens the published catalogue (the API's G-2 gate). */
const CATALOGUE_READ_SLUGS = ["ipm-templates", "ipm", "calibration"] as const;

/** The tabs a caller sees, in order. */
export const tabsFor = (p: { superAdmin: boolean; facilityBound: boolean; canRead: (slug: string) => boolean }): Tab[] => {
  if (p.superAdmin) return ["checklists", "library", "types", "queue", "published"];
  const tabs: Tab[] = [];
  if (CATALOGUE_READ_SLUGS.some((slug) => p.canRead(slug))) tabs.push("published");
  if (!p.facilityBound && p.canRead("ipm-templates")) tabs.push("proposals");
  return tabs;
};

export function IpmTemplatesClient({ languageForm }: { languageForm?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const permissions = usePermissions();
  const tabs = tabsFor(permissions);
  const [chosen, setChosen] = useState<Tab | null>(null);
  const tab = chosen !== null && tabs.includes(chosen) ? chosen : tabs[0];

  if (!permissions.loaded) {
    return (
      <DashboardLayout>
        <div lang={locale}>
          <h1 className="sr-only">{t("ipmCatalogue.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("ipmCatalogue.loading")}</p>
        </div>
      </DashboardLayout>
    );
  }

  if (tab === undefined) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center" lang={locale}>
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground mb-2">{t("ipmCatalogue.title")}</h1>
          <p className="text-muted-foreground">{t("ipmCatalogue.restricted")}</p>
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
    document.getElementById(`ipm-tab-${next}`)?.focus();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" lang={locale}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-primary" aria-hidden="true" />
              {t("ipmCatalogue.title")}
            </h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              {permissions.superAdmin ? t("ipmCatalogue.leadOperator") : t("ipmCatalogue.leadTenant")}
            </p>
          </div>
          {languageForm}
        </div>

        {tabs.length > 1 && (
          <div role="tablist" aria-label={t("ipmCatalogue.tabs")} className="flex flex-wrap gap-2">
            {tabs.map((name, index) => (
              <button
                key={name}
                id={`ipm-tab-${name}`}
                type="button"
                role="tab"
                aria-selected={tab === name}
                aria-controls="ipm-tabpanel"
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setChosen(name)}
                onKeyDown={(e) => onKey(e, index)}
                className={`min-h-9 px-3 py-1.5 rounded-md text-sm border ${
                  tab === name ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:bg-muted"
                }`}
              >
                {t(`ipmCatalogue.tab.${name}` as MessageKey)}
              </button>
            ))}
          </div>
        )}

        <div id="ipm-tabpanel" role={tabs.length > 1 ? "tabpanel" : undefined} aria-labelledby={tabs.length > 1 ? `ipm-tab-${tab}` : undefined}>
          {tab === "checklists" && <TemplatesPanel />}
          {tab === "library" && <ItemLibraryPanel />}
          {tab === "types" && <DeviceTypesPanel />}
          {tab === "queue" && <ProposalQueuePanel />}
          {tab === "published" && <PublishedCataloguePanel />}
          {tab === "proposals" && <ProposalsPanel canWrite={permissions.canWrite("ipm-templates")} />}
        </div>
      </div>
    </DashboardLayout>
  );
}
