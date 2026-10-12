"use client";
/**
 * P22-10c2 — Register a device (P19-08 § 3.2; P19-03): the create form queued with a `clientRef`
 * (the engine adds it), and two photos (front, serial plate). A provider user (unbound) types the
 * sticker's QR and picks one of the downloaded facilities; a facility user (bound) has no QR field
 * and no facility choice (ADR-132: the server stamps its facility). A room is chosen from the
 * downloaded list — a room is never created offline (P19-03 § 6.3). The device type comes from the
 * local catalogue, so an IPM of the new device can start at once (it waits for the registration to
 * sync before it is sent — `dependsOn`).
 */
import React, { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import type { PhotoRefusal } from "../../app/photos";
import { ScreenTitle } from "../FieldApp";
import { useField, useFieldStoreApi, useFieldText } from "../context";
import { go } from "../nav";
import { FIELD_INPUT } from "./common";
import { versionFor } from "./checklist";

const CONDITIONS = ["good", "not_good", "broken"] as const;
const PHOTOS = [
  { purpose: "device_front", key: "field.register.photoFront" },
  { purpose: "device_serial_plate", key: "field.register.photoPlate" },
] as const;

interface Draft {
  name: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  qrCode: string;
  deviceTypeId: string;
  clientFacilityId: string;
  locationId: string;
  condition: string;
}

const opt = (v: string): string | null => (v.trim() === "" ? null : v.trim());

/** The create body: only the fields the user's contract accepts (a bound user's has no QR and no facility). */
export const deviceBody = (d: Draft, bound: boolean): Record<string, unknown> => ({
  name: d.name.trim(),
  serialNumber: opt(d.serialNumber),
  manufacturer: opt(d.manufacturer),
  model: opt(d.model),
  deviceTypeId: opt(d.deviceTypeId),
  ...(d.locationId ? { locationId: d.locationId } : {}),
  ...(d.condition ? { condition: d.condition } : {}),
  ...(bound ? {} : { qrCode: opt(d.qrCode), ...(d.clientFacilityId ? { clientFacilityId: d.clientFacilityId } : {}) }),
});

export function RegisterScreen() {
  const { t } = useFieldText();
  const api = useFieldStoreApi();
  const user = useField((s) => s.user);
  const facilities = useField((s) => s.facilities);
  const rooms = useField((s) => s.rooms);
  const catalogue = useField((s) => s.catalogue);
  const bound = (user?.clientFacilityId ?? null) !== null;
  const [draft, setDraft] = useState<Draft>({
    name: "",
    manufacturer: "",
    model: "",
    serialNumber: "",
    qrCode: "",
    deviceTypeId: "",
    clientFacilityId: facilities.length === 1 ? (facilities[0]?.id ?? "") : "",
    locationId: "",
    condition: "",
  });
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<PhotoRefusal[]>([]);
  const [busy, setBusy] = useState(false);
  const field = (k: keyof Draft) => ({ id: `field-reg-${k}`, value: draft[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft({ ...draft, [k]: e.target.value }) });
  const valid = draft.name.trim() !== "" && (bound || draft.clientFacilityId !== "");

  const save = async () => {
    setBusy(true);
    const s = api.getState();
    const localId = await s.createCapture({ kind: "device", device: deviceBody(draft, bound) });
    const refused: PhotoRefusal[] = [];
    for (const p of PHOTOS) {
      const file = files[p.purpose];
      if (!file) continue;
      const r = await s.addPhoto(localId, file, p.purpose);
      if (r) refused.push(r);
    }
    await s.submit(localId);
    setRefusals(refused);
    setSaved(localId);
    setBusy(false);
  };

  const startIpm = async () => {
    const version = versionFor(catalogue, draft.deviceTypeId || null);
    if (!saved || !version) return;
    const localId = await api.getState().createCapture({ kind: "ipm", dependsOn: saved, templateVersionId: version.id, header: { performedAt: new Date().toISOString() } });
    go("capture", { ref: localId });
  };

  if (saved) {
    const version = versionFor(catalogue, draft.deviceTypeId || null);
    return (
      <section className="space-y-4">
        <ScreenTitle>{t("field.register.savedTitle")}</ScreenTitle>
        <p className="text-sm">{t("field.register.saved")}</p>
        {refusals.map((r, i) => (
          <p key={i} role="alert" className="text-sm text-destructive">
            {t(`field.photo.refused.${r}` as "field.photo.refused.too_large")}
          </p>
        ))}
        {version ? <Button onClick={() => void startIpm()}>{t("field.register.startIpm")}</Button> : <p className="text-sm text-muted-foreground">{t("field.device.noChecklist")}</p>}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <ScreenTitle>{t("field.register.title")}</ScreenTitle>
      <Card>
        <CardContent className="space-y-3 p-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) void save();
            }}
          >
            {(
              [
                ["name", "field.register.name"],
                ["manufacturer", "field.register.manufacturer"],
                ["model", "field.register.model"],
                ["serialNumber", "field.register.serial"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="space-y-1">
                <label htmlFor={`field-reg-${k}`} className="block text-sm font-semibold">
                  {t(label)}
                  {k === "name" ? ` ${t("field.required")}` : ""}
                </label>
                <input className={FIELD_INPUT} {...field(k)} required={k === "name"} />
              </div>
            ))}
            {!bound && (
              <div className="space-y-1">
                <label htmlFor="field-reg-qrCode" className="block text-sm font-semibold">
                  {t("field.register.qr")}
                </label>
                <input className={FIELD_INPUT} {...field("qrCode")} autoComplete="off" />
              </div>
            )}
            {!bound && (
              <div className="space-y-1">
                <label htmlFor="field-reg-clientFacilityId" className="block text-sm font-semibold">
                  {t("field.register.facility")} {t("field.required")}
                </label>
                <select className={FIELD_INPUT} {...field("clientFacilityId")} required>
                  <option value="">{t("field.register.choose")}</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="field-reg-deviceTypeId" className="block text-sm font-semibold">
                {t("field.register.type")}
              </label>
              <select className={FIELD_INPUT} {...field("deviceTypeId")}>
                <option value="">{t("field.register.choose")}</option>
                {(catalogue?.deviceTypes ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="field-reg-locationId" className="block text-sm font-semibold">
                {t("field.register.room")}
              </label>
              <select className={FIELD_INPUT} {...field("locationId")}>
                <option value="">{t("field.register.choose")}</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t("field.register.roomOnline")}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="field-reg-condition" className="block text-sm font-semibold">
                {t("field.device.condition")}
              </label>
              <select className={FIELD_INPUT} {...field("condition")}>
                <option value="">{t("field.register.choose")}</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {t(`field.condition.${c}`)}
                  </option>
                ))}
              </select>
            </div>
            {PHOTOS.map((p) => (
              <div key={p.purpose} className="space-y-1">
                <label htmlFor={`field-reg-${p.purpose}`} className="block text-sm font-semibold">
                  {t(p.key)}
                </label>
                <input
                  id={`field-reg-${p.purpose}`}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="block w-full text-sm"
                  onChange={(e) => setFiles({ ...files, [p.purpose]: e.target.files?.[0] ?? null })}
                />
              </div>
            ))}
            <Button type="submit" disabled={!valid || busy} isLoading={busy}>
              {t("field.register.save")}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Alert variant="info" title={t("field.register.queuedTitle")}>
        <p>{t("field.register.queued")}</p>
      </Alert>
    </section>
  );
}
