"use client";

/**
 * P22-02 (F-23, F-24, F-26 … F-28, F-31; P19-03 § 4 – § 6, § 8.1) — register or edit a device.
 *
 * What a writer may set follows the server's two contracts (spec § 5): a facility-BOUND technician
 * sees no QR, status, laboratory, store or facility field (its body never carries them — each
 * would be a strict 400); a provider user names the facility on create (required when the tenant
 * serves other facilities, G-D10) and never changes it by an edit (the move does). The room is
 * typed (name + floor) and found or created by the server in the device's facility (G-D7).
 *
 * The form's checks run before a round trip; the server still decides. A refusal — a taken QR or
 * serial (409, naming the holder), an ended facility (409), a retired type (400) — is shown as the
 * server wrote it, and the form is kept.
 */
import React, { useEffect, useState } from "react";
import { Alert, Button, Dialog } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { calibrationDatesService, type Laboratory } from "@/api/services/calibrationDates.service";
import { clientFacilityService, type ClientFacilityOption } from "@/api/services/clientFacility.service";
import { deviceRegisterService, type RegisterDevice, type StoreLocation } from "@/api/services/deviceRegister.service";
import { deferEffect } from "@/lib/deferEffect";
import type { MessageKey } from "@/i18n";
import {
  buildCreateBody,
  buildUpdateBody,
  emptyForm,
  formFromDevice,
  formProblems,
  todayDay,
  INVENTORY_EARLIEST,
  IPM_INTERVAL_MAX,
  type Accessories,
  type Condition,
  type DeviceForm,
  type LocationMode,
  type Status,
} from "../register";
import { TypePicker } from "./TypePicker";
import { FIELD, Field, useDeviceText } from "./shared";

interface Props {
  /** The device to edit, or null to register a new one. */
  device: RegisterDevice | null;
  bound: boolean;
  /** `vendors` read: the calibration laboratory can be picked. */
  canPickLab: boolean;
  onClose: () => void;
  /** Saved: the device as the server answered it, and whether it was just created. */
  onSaved: (device: RegisterDevice, created: boolean) => void;
}

const CONDITIONS: Condition[] = ["", "good", "not_good", "broken"];
const STATUSES: Status[] = ["active", "inactive", "maintenance", "retired"];

export function DeviceFormDialog({ device, bound, canPickLab, onClose, onSaved }: Props) {
  const text = useDeviceText();
  const { t } = text;
  const creating = device === null;
  const [before] = useState<DeviceForm>(() => (device ? formFromDevice(device) : emptyForm()));
  const [form, setForm] = useState<DeviceForm>(before);
  const [facilities, setFacilities] = useState<ClientFacilityOption[] | null>(null);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [labs, setLabs] = useState<Laboratory[]>([]);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Provider staff only: the facilities (create), the stores and the laboratories. A failed read
  // leaves that choice out (the room and a typed facility-less create still work); the facility's
  // failure is said, since a multi-facility create needs it.
  useEffect(() => {
    if (bound) return undefined;
    return deferEffect(async () => {
      const [facilityList, storeList, labList] = await Promise.allSettled([
        creating ? clientFacilityService.options() : Promise.resolve([]),
        deviceRegisterService.stores(),
        canPickLab ? calibrationDatesService.laboratories() : Promise.resolve([]),
      ]);
      const open = facilityList.status === "fulfilled" ? facilityList.value.filter((f) => f.status !== "ended") : [];
      setFacilities(facilityList.status === "fulfilled" ? open : []);
      if (creating && open.length === 1 && open[0]) {
        const only = open[0].id;
        setForm((current) => (current.clientFacilityId ? current : { ...current, clientFacilityId: only }));
      }
      setStores(storeList.status === "fulfilled" ? storeList.value : []);
      setLabs(labList.status === "fulfilled" ? labList.value : []);
    });
  }, [bound, creating, canPickLab]);

  const facilityRequired = !bound && creating && (facilities ?? []).some((f) => !f.isSelf);
  const writer = { bound, facilityRequired };
  const today = todayDay();
  const problems = formProblems(form, writer, creating, today);
  const set = (patch: Partial<DeviceForm>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (problems.length > 0) return;
    setSaving(true);
    setRefusal(null);
    try {
      const saved = device
        ? await deviceRegisterService.update(device.id, buildUpdateBody(form, before, writer))
        : await deviceRegisterService.create(buildCreateBody(form, writer));
      onSaved(saved, creating);
    } catch (err) {
      setRefusal(describeApiError(err).message || t("devices.form.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const locationModes: LocationMode[] = bound ? ["room", "none"] : ["room", "store", "none"];

  return (
    <Dialog isOpen onClose={onClose} title={creating ? t("devices.form.createTitle") : t("devices.form.editTitle", { name: device.name })} size="xl">
      <form noValidate className="space-y-6" onSubmit={(e) => void submit(e)}>
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold">{t("devices.form.identity")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="device-name" label={t("devices.field.name")}>
              <input id="device-name" required className={FIELD} value={form.name} maxLength={255} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            {!bound && (
              <Field id="device-qr" label={t("devices.field.qr")} help={t("devices.field.qrHelp")}>
                <input
                  id="device-qr"
                  className={`${FIELD} font-mono uppercase`}
                  value={form.qrCode}
                  maxLength={64}
                  autoComplete="off"
                  aria-describedby="device-qr-help"
                  onChange={(e) => set({ qrCode: e.target.value })}
                />
              </Field>
            )}
          </div>
          <TypePicker
            id="device-type"
            label={t("devices.field.type")}
            value={form.deviceTypeId}
            valueName={form.deviceTypeName}
            noneLabel={t("devices.type.noneChosen")}
            onChange={(deviceTypeId, deviceTypeName) => set({ deviceTypeId, deviceTypeName })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="device-manufacturer" label={t("devices.field.manufacturer")}>
              <input id="device-manufacturer" className={FIELD} value={form.manufacturer} maxLength={255} onChange={(e) => set({ manufacturer: e.target.value })} />
            </Field>
            <Field id="device-model" label={t("devices.field.model")}>
              <input id="device-model" className={FIELD} value={form.model} maxLength={255} onChange={(e) => set({ model: e.target.value })} />
            </Field>
            <Field id="device-serial" label={t("devices.field.serial")} help={t("devices.field.serialHelp")}>
              <input
                id="device-serial"
                className={`${FIELD} font-mono`}
                value={form.serialNumber}
                maxLength={100}
                aria-describedby="device-serial-help"
                onChange={(e) => set({ serialNumber: e.target.value })}
              />
            </Field>
            <Field id="device-category" label={t("devices.field.category")}>
              <input id="device-category" className={FIELD} value={form.category} maxLength={100} onChange={(e) => set({ category: e.target.value })} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-semibold">{t("devices.form.where")}</legend>
          {!bound && creating && (
            <Field id="device-facility" label={t("devices.field.facility")} help={facilityRequired ? t("devices.field.facilityRequired") : undefined}>
              <select
                id="device-facility"
                className={FIELD}
                value={form.clientFacilityId}
                disabled={facilities === null}
                onChange={(e) => set({ clientFacilityId: e.target.value })}
              >
                <option value="">{facilities === null ? t("devices.loading") : t("devices.field.facilityChoose")}</option>
                {(facilities ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {!bound && !creating && device.clientFacility && (
            <p className="text-sm">
              <span className="text-muted-foreground">{t("devices.field.facility")}: </span>
              <span className="font-medium">{device.clientFacility.name}</span>
            </p>
          )}
          <div role="radiogroup" aria-label={t("devices.field.location")} className="flex flex-wrap gap-4">
            {locationModes.map((mode) => (
              <label key={mode} className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="device-location-mode" value={mode} checked={form.locationMode === mode} onChange={() => set({ locationMode: mode })} />
                {t(`devices.location.${mode}` as MessageKey)}
              </label>
            ))}
          </div>
          {form.locationMode === "room" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="device-room" label={t("devices.field.room")} help={t("devices.field.roomHelp")}>
                <input id="device-room" className={FIELD} value={form.roomName} maxLength={255} aria-describedby="device-room-help" onChange={(e) => set({ roomName: e.target.value })} />
              </Field>
              <Field id="device-floor" label={t("devices.field.floor")}>
                <input id="device-floor" className={FIELD} value={form.roomFloor} maxLength={50} onChange={(e) => set({ roomFloor: e.target.value })} />
              </Field>
            </div>
          )}
          {form.locationMode === "store" && !bound && (
            <Field id="device-store" label={t("devices.field.store")}>
              <select id="device-store" className={FIELD} value={form.storeId} onChange={(e) => set({ storeId: e.target.value })}>
                <option value="">{stores.length === 0 ? t("devices.field.storeNone") : t("devices.field.storeChoose")}</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </Field>
          )}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-semibold">{t("devices.form.state")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="device-condition" label={t("devices.field.condition")}>
              <select id="device-condition" className={FIELD} value={form.condition} onChange={(e) => set({ condition: e.target.value as Condition })}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {text.condition(c || null)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="device-accessories" label={t("devices.field.accessories")}>
              <select id="device-accessories" className={FIELD} value={form.accessories} onChange={(e) => set({ accessories: e.target.value as Accessories })}>
                <option value="">{t("devices.accessories.unset")}</option>
                <option value="yes">{t("devices.accessories.yes")}</option>
                <option value="no">{t("devices.accessories.no")}</option>
              </select>
            </Field>
            <Field id="device-inventoried" label={t("devices.field.inventoriedOn")}>
              <input
                id="device-inventoried"
                type="date"
                className={FIELD}
                min={INVENTORY_EARLIEST}
                max={today}
                value={form.inventoriedOn}
                onChange={(e) => set({ inventoriedOn: e.target.value })}
              />
            </Field>
            {!bound && (
              <Field id="device-status" label={t("devices.field.status")}>
                <select id="device-status" className={FIELD} value={form.status} onChange={(e) => set({ status: e.target.value as Status })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {text.status(s)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-semibold">{t("devices.form.schedule")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {!bound && canPickLab && (
              <Field id="device-lab" label={t("devices.field.lab")}>
                <select id="device-lab" className={FIELD} value={form.calibrationVendorId} onChange={(e) => set({ calibrationVendorId: e.target.value })}>
                  <option value="">{t("devices.field.labNone")}</option>
                  {form.calibrationVendorId && !labs.some((l) => l.id === form.calibrationVendorId) && (
                    <option value={form.calibrationVendorId}>{device?.calibrationVendorDisplay?.name ?? t("devices.field.labCurrent")}</option>
                  )}
                  {labs.map((lab) => (
                    <option key={lab.id} value={lab.id}>
                      {lab.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field id="device-installed" label={t("devices.field.installationDate")}>
              <input id="device-installed" type="date" className={FIELD} value={form.installationDate} onChange={(e) => set({ installationDate: e.target.value })} />
            </Field>
            <Field id="device-next" label={t("devices.field.nextCalibration")} help={t("devices.field.nextCalibrationHelp")}>
              <input
                id="device-next"
                type="date"
                className={FIELD}
                value={form.nextCalibrationDate}
                aria-describedby="device-next-help"
                onChange={(e) => set({ nextCalibrationDate: e.target.value })}
              />
            </Field>
            <Field id="device-interval" label={t("devices.field.interval")}>
              <input
                id="device-interval"
                type="number"
                inputMode="numeric"
                min={1}
                className={FIELD}
                value={form.calibrationIntervalDays}
                onChange={(e) => set({ calibrationIntervalDays: e.target.value })}
              />
            </Field>
            <Field id="device-ipm-interval" label={t("devices.field.ipmInterval")} help={t("devices.field.ipmIntervalHelp")}>
              <input
                id="device-ipm-interval"
                type="number"
                inputMode="numeric"
                min={0}
                max={IPM_INTERVAL_MAX}
                className={FIELD}
                value={form.ipmIntervalMonths}
                aria-describedby="device-ipm-interval-help"
                onChange={(e) => set({ ipmIntervalMonths: e.target.value })}
              />
            </Field>
          </div>
          <Field id="device-remarks" label={t("devices.field.remarks")}>
            <textarea id="device-remarks" rows={3} className={FIELD} value={form.remarks} maxLength={2000} onChange={(e) => set({ remarks: e.target.value })} />
          </Field>
        </fieldset>

        {showProblems && problems.length > 0 && (
          <div role="alert">
            <Alert variant="error" title={t("devices.form.problemsTitle")}>
              <ul className="list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{t(`devices.problem.${p}` as MessageKey)}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
        {refusal && (
          <div role="alert">
            <Alert variant="error" title={t("devices.form.refusedTitle")}>
              <p>{refusal}</p>
            </Alert>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("devices.cancel")}
          </Button>
          <Button type="submit" isLoading={saving}>
            {creating ? t("devices.form.create") : t("devices.form.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
