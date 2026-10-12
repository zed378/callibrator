"use client";
/**
 * P22-10c2 — Device (P19-08 § 3.2): what the working set holds about it (identity, room, condition,
 * last IPM), and "Start IPM" — or "Resume" when this phone holds an open capture for it. The
 * checklist is the published version of the device's type, from the local catalogue.
 */
import React, { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { ScreenTitle } from "../FieldApp";
import { useField, useFieldStoreApi, useFieldText } from "../context";
import { go } from "../nav";
import { ScreenLink } from "./common";
import { versionFor } from "./checklist";

export function DeviceScreen({ id }: { id: string | null }) {
  const { t, when } = useFieldText();
  const api = useFieldStoreApi();
  const index = useField((s) => s.index);
  const rooms = useField((s) => s.rooms);
  const captures = useField((s) => s.captures);
  const catalogue = useField((s) => s.catalogue);
  const [busy, setBusy] = useState(false);
  const device = id ? index.byId(id) : null;

  if (!device) {
    return (
      <section className="space-y-3">
        <ScreenTitle>{t("field.device.missingTitle")}</ScreenTitle>
        <p className="text-sm">{t("field.device.missing")}</p>
        <ScreenLink view="scan">{t("field.nav.scan")}</ScreenLink>
      </section>
    );
  }
  const open = captures.find((c) => c.kind === "ipm" && c.deviceId === device.id && (c.state === "editing" || c.state === "attention"));
  const version = versionFor(catalogue, device.deviceTypeId);
  const room = rooms.find((r) => r.id === device.locationId)?.name ?? "—";

  const start = async () => {
    if (!version) return;
    setBusy(true);
    const localId = await api.getState().createCapture({
      kind: "ipm",
      deviceId: device.id,
      templateVersionId: version.id,
      header: { performedAt: new Date().toISOString(), ...(device.locationId ? { locationId: device.locationId } : {}) },
    });
    setBusy(false);
    go("capture", { ref: localId });
  };

  const rows: [string, string][] = [
    [t("field.device.qr"), device.qrCode ?? "—"],
    [t("field.device.serial"), device.serialNumber ?? "—"],
    [t("field.device.maker"), [device.manufacturer, device.model].filter(Boolean).join(" ") || "—"],
    [t("field.device.room"), room],
    [t("field.device.condition"), device.condition ? t(`field.condition.${device.condition}` as "field.condition.good") : "—"],
    [t("field.device.lastIpm"), device.lastIpm ? t("field.device.lastIpmValue", { visit: device.lastIpm.visitNumber, time: when(device.lastIpm.performedAt) }) : t("field.device.never")],
  ];

  return (
    <section className="space-y-4">
      <ScreenTitle>{device.name}</ScreenTitle>
      <Card>
        <CardContent className="p-4">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      {open ? (
        <ScreenLink view="capture" refId={open.localId}>
          {t("field.device.resume")}
        </ScreenLink>
      ) : version ? (
        <Button onClick={() => void start()} disabled={busy} isLoading={busy}>
          {t("field.device.start")}
        </Button>
      ) : (
        <Alert variant="warning" title={t("field.device.noChecklistTitle")}>
          <p>{t("field.device.noChecklist")}</p>
        </Alert>
      )}
    </section>
  );
}
