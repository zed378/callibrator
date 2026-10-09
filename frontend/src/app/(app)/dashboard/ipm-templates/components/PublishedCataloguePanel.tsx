"use client";

/**
 * P22-01 — the published catalogue, read-only, for every reader (tenant users, facility-bound
 * users and the operator alike): `GET /ipm/templates/published`, one document. Choosing a device
 * type shows the checklist a new inspection of that type pins — the type's own published version,
 * else the base checklist (`resolveTemplateVersion`, the same function the server and the offline
 * client run).
 */
import React, { useCallback, useEffect, useState } from "react";
import { resolveTemplateVersion } from "@callibrator/contracts/inspectionValues";
import { Card, CardContent, ErrorState } from "@/components/ui";
import { deferEffect } from "@/lib/deferEffect";
import { ipmCatalogueService, type PublishedCatalogue } from "@/api/services/ipmCatalogue.service";
import { orderedItems } from "../catalogue";
import { FIELD, SectionItems, useCatalogueText } from "./shared";

export function PublishedCataloguePanel() {
  const text = useCatalogueText();
  const { t } = text;
  const [catalogue, setCatalogue] = useState<PublishedCatalogue | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [typeId, setTypeId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalogue(await ipmCatalogueService.getPublishedCatalogue());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);

  if (loading) return <p className="text-sm text-muted-foreground">{t("ipmCatalogue.loading")}</p>;
  if (error !== null || catalogue === null) return <ErrorState error={error} onRetry={() => void load()} />;

  const needle = filter.trim().toLowerCase();
  const types = catalogue.deviceTypes.filter((d) => needle === "" || d.name.toLowerCase().includes(needle));
  const version = resolveTemplateVersion(catalogue.versions, typeId || null);
  const typeName = catalogue.deviceTypes.find((d) => d.id === typeId)?.name ?? null;
  const usesBase = typeId !== "" && version !== null && version.deviceTypeId === null;

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{t("ipmCatalogue.published.heading")}</h2>
          <p className="text-sm text-muted-foreground">{t("ipmCatalogue.published.lead")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="published-filter" className="block text-sm font-semibold">
                {t("ipmCatalogue.published.filter")}
              </label>
              <input id="published-filter" className={FIELD} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="published-type" className="block text-sm font-semibold">
                {t("ipmCatalogue.published.deviceType")}
              </label>
              <select id="published-type" className={FIELD} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">{t("ipmCatalogue.published.baseOption")}</option>
                {types.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("ipmCatalogue.published.counts", { types: catalogue.deviceTypes.length, versions: catalogue.versions.length })}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          {version === null ? (
            <p className="text-sm text-muted-foreground">{t("ipmCatalogue.published.noneYet")}</p>
          ) : (
            <>
              <div>
                <h3 className="text-base font-semibold">
                  {version.deviceTypeId === null ? t("ipmCatalogue.base") : (typeName ?? t("ipmCatalogue.base"))}
                  {" · "}
                  {t("ipmCatalogue.version", { n: version.versionNumber ?? "—" })}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t("ipmCatalogue.published.publishedOn", { date: text.date(version.publishedAt) })}
                  {version.contentHash ? (
                    <>
                      {" · "}
                      <span className="font-mono">{t("ipmCatalogue.published.hash", { hash: version.contentHash.slice(0, 12) })}</span>
                    </>
                  ) : null}
                </p>
              </div>
              {usesBase && (
                <p className="text-sm text-muted-foreground">{t("ipmCatalogue.published.usesBase", { name: typeName ?? "" })}</p>
              )}
              <SectionItems
                items={orderedItems(version.items)}
                tag={(item) =>
                  version.deviceTypeId !== null && item.origin === "base" ? (
                    <span className="ml-2 text-xs text-muted-foreground">{t("ipmCatalogue.items.fromBase")}</span>
                  ) : null
                }
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
