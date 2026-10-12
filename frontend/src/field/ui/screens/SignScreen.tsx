"use client";
/**
 * P22-10c2 — Sign (P19-08 § 12): signing is ONLINE only and never stores a credential. The field app
 * lists the user's submitted visits (read at each sync) and opens each one's report page — a full
 * navigation to `/dashboard/ipm/sessions/<id>/report`, where P23-02's Sign dialog is (ADR-127
 * Am. 4 § 3). Offline the list says it needs a connection.
 */
import React from "react";
import { ScreenTitle } from "../FieldApp";
import { useField, useFieldText } from "../context";

export function SignScreen() {
  const { t, when } = useFieldText();
  const online = useField((s) => s.online);
  const submitted = useField((s) => s.submitted);
  const index = useField((s) => s.index);
  return (
    <section className="space-y-4">
      <ScreenTitle>{t("field.sign.title")}</ScreenTitle>
      <p className="text-sm text-muted-foreground">{t("field.sign.lead")}</p>
      {!online && <p className="text-sm">{t("field.sign.needsConnection")}</p>}
      {submitted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("field.sign.empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {submitted.map((v) => {
            const name = index.byId(v.deviceId)?.name ?? t("field.outbox.ipm");
            const label = t("field.sign.row", { name, visit: v.visitNumber ?? "—", time: when(v.performedAt) });
            return (
              <li key={v.id} className="flex min-h-11 items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{label}</span>
                {online ? (
                  <a href={`/dashboard/ipm/sessions/${v.id}/report`} className="underline" aria-label={t("field.sign.open", { name: label })}>
                    {t("field.sign.openShort")}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{t("field.sign.needsConnectionShort")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
