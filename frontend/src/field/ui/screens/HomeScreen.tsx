"use client";
/**
 * P22-10c2 — Home (P19-08 § 3.2): the outbox and its state, the last sync (server time), each
 * offline facility with its expiry ("purged in 41 h unless synced"), "Sync now", Scan, Register,
 * another user's pending captures (a count), and the visits waiting for a signature.
 */
import React, { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { ScreenTitle } from "../FieldApp";
import { useField, useFieldStoreApi, useFieldText } from "../context";
import { HOUR_MS, ScreenLink, WORKING_SET_LIFE_MS } from "./common";

export function HomeScreen() {
  const { t, when } = useFieldText();
  const api = useFieldStoreApi();
  const status = useField((s) => s.status);
  const online = useField((s) => s.online);
  const syncing = useField((s) => s.syncing);
  const facilities = useField((s) => s.facilities);
  const lastSyncDeviceAt = useField((s) => s.lastSyncDeviceAt);
  const othersPending = useField((s) => s.othersPending);
  const submitted = useField((s) => s.submitted);
  const report = useField((s) => s.lastReport);
  // The time this screen opened: the expiry is a whole number of hours, read again on the next visit.
  const [now] = useState(() => api.getState().now());

  const hoursLeft = lastSyncDeviceAt === null ? null : Math.max(0, Math.floor((lastSyncDeviceAt + WORKING_SET_LIFE_MS - now) / HOUR_MS));

  return (
    <section className="space-y-4">
      <ScreenTitle>{t("field.home.title")}</ScreenTitle>
      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-sm">
            {t("field.home.outbox", { count: status?.outbox ?? 0 })}
            {(status?.attention ?? 0) > 0 && <> · {t("field.home.attention", { count: status?.attention ?? 0 })}</>}
          </p>
          <p className="text-sm text-muted-foreground">{t("field.home.lastSync", { time: when(status?.lastSyncServerAt ?? null) })}</p>
          {report && !report.offline && report.waiting > 0 && <p className="text-sm text-muted-foreground">{t("field.home.waiting", { count: report.waiting })}</p>}
          {!online && (status?.outbox ?? 0) > 0 && <p className="text-sm">{t("field.home.openOnline")}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {/* Enabled offline too: `navigator.onLine` is only a hint; the cycle says whether the server answered. */}
            <Button onClick={() => void api.getState().syncNow("button")} disabled={syncing} isLoading={syncing}>
              {syncing ? t("field.home.syncing") : t("field.home.syncNow")}
            </Button>
            <ScreenLink view="scan">{t("field.home.scan")}</ScreenLink>
            <ScreenLink view="register">{t("field.home.register")}</ScreenLink>
          </div>
        </CardContent>
      </Card>

      {othersPending > 0 && (
        <Alert variant="warning" title={t("field.home.othersTitle")}>
          <p>{t("field.home.others", { count: othersPending })}</p>
        </Alert>
      )}

      <section aria-labelledby="field-home-sets" className="space-y-2">
        <h2 id="field-home-sets" className="text-base font-semibold">
          {t("field.home.setsTitle")}
        </h2>
        {facilities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("field.home.noSet")} <ScreenLink view="settings" className="underline">{t("field.home.prepare")}</ScreenLink>
          </p>
        ) : (
          <ul className="space-y-1">
            {facilities.map((f) => (
              <li key={f.id} className="text-sm">
                <span className="font-medium">{f.name}</span> — {t("field.home.devices", { count: f.deviceCount })}
                {hoursLeft !== null && <span className="text-muted-foreground"> · {t("field.home.expires", { hours: hoursLeft })}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="field-home-sign" className="space-y-2">
        <h2 id="field-home-sign" className="text-base font-semibold">
          {t("field.home.signTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("field.home.signLead", { count: submitted.length })}</p>
        <ScreenLink view="sign">{t("field.home.signOpen")}</ScreenLink>
      </section>
    </section>
  );
}
