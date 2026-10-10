"use client";

/**
 * P22-02 (F-25, F-28; P19-03 § 7.2, ADR-132 Am. 3) — a device's two register photos: the front and
 * the serial plate. Each slot shows its thumbnail through a signed link, and offers take / choose
 * (the phone's camera on a phone), replace and delete. Every photo is made a downscaled JPEG in the
 * browser first (`lib/photoPrep`): the server refuses HEIC (415 `PHOTO_HEIC_UNSUPPORTED`).
 *
 * After a registration the dialog opens in `register` mode: the two photos are required before
 * "Finish" (the API does not require them — offline registration uploads them later, G-D5 — so the
 * page does). "Finish later" leaves the device listed as "photos missing".
 */
import React, { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { Alert, Button, ConfirmDialog, Dialog } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { deviceRegisterService, type DevicePhotoPurpose, type RegisterDevice } from "@/api/services/deviceRegister.service";
import { PHOTO_ACCEPT, PhotoPrepError, preparePhoto } from "@/lib/photoPrep";
import type { MessageKey } from "@/i18n";
import { PhotoThumb } from "./PhotoThumb";
import { useDeviceText } from "./shared";

type Slot = Extract<DevicePhotoPurpose, "device_front" | "device_serial_plate">;
const SLOTS: readonly Slot[] = ["device_front", "device_serial_plate"];

interface Props {
  device: RegisterDevice;
  /** `register`: just created — both photos required before Finish. */
  mode: "register" | "manage";
  canWrite: boolean;
  /** Closed; `changed` when a photo was added, replaced or deleted. */
  onClose: (changed: boolean) => void;
}

const initial = (d: RegisterDevice): Record<Slot, string | null> => ({
  device_front: d.frontPhotoAttachmentId ?? null,
  device_serial_plate: d.serialPlatePhotoAttachmentId ?? null,
});

export function PhotosDialog({ device, mode, canWrite, onClose }: Props) {
  const { t } = useDeviceText();
  const [photos, setPhotos] = useState<Record<Slot, string | null>>(() => initial(device));
  const [busy, setBusy] = useState<Slot | null>(null);
  const [error, setError] = useState<{ slot: Slot; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Slot | null>(null);
  const [changed, setChanged] = useState(false);
  const inputs = useRef<Partial<Record<Slot, HTMLInputElement | null>>>({});

  const complete = photos.device_front !== null && photos.device_serial_plate !== null;
  const slotName = (slot: Slot) => t(`devices.photos.${slot}` as MessageKey);

  const upload = async (slot: Slot, file: File) => {
    setBusy(slot);
    setError(null);
    try {
      const prepared = await preparePhoto(file);
      const photo = await deviceRegisterService.uploadPhoto(device.id, slot, prepared);
      setPhotos((current) => ({ ...current, [slot]: photo.id }));
      setChanged(true);
    } catch (err) {
      const message =
        err instanceof PhotoPrepError ? t(`devices.photos.prep.${err.reason}` as MessageKey) : describeApiError(err).message || t("devices.photos.uploadFailed");
      setError({ slot, message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (slot: Slot) => {
    const id = photos[slot];
    setConfirmDelete(null);
    if (!id) return;
    setBusy(slot);
    setError(null);
    try {
      await deviceRegisterService.deletePhoto(device.id, id);
      setPhotos((current) => ({ ...current, [slot]: null }));
      setChanged(true);
    } catch (err) {
      setError({ slot, message: describeApiError(err).message || t("devices.photos.deleteFailed") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Dialog
        isOpen
        onClose={() => onClose(changed)}
        title={mode === "register" ? t("devices.photos.registerTitle", { name: device.name }) : t("devices.photos.title", { name: device.name })}
        size="xl"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{mode === "register" ? t("devices.photos.registerLead") : t("devices.photos.lead")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {SLOTS.map((slot) => {
              const id = photos[slot];
              const inputId = `photo-${slot}`;
              return (
                <section key={slot} aria-labelledby={`${inputId}-heading`} className="space-y-3 rounded-lg border border-border p-4">
                  <h3 id={`${inputId}-heading`} className="text-sm font-semibold">
                    {slotName(slot)}
                  </h3>
                  {id ? (
                    <PhotoThumb
                      attachmentId={id}
                      variant="display"
                      className="h-40 w-full"
                      alt={t("devices.photos.alt", { slot: slotName(slot), name: device.name })}
                      unavailable={t("devices.photos.unavailable")}
                    />
                  ) : (
                    <p className="flex h-40 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                      {t("devices.photos.none")}
                    </p>
                  )}
                  {canWrite && (
                    <div className="flex flex-wrap gap-2">
                      <input
                        id={inputId}
                        ref={(el) => {
                          inputs.current[slot] = el;
                        }}
                        type="file"
                        accept={PHOTO_ACCEPT}
                        capture="environment"
                        className="sr-only"
                        tabIndex={-1}
                        aria-label={t(id ? "devices.photos.replace" : "devices.photos.add", { slot: slotName(slot) })}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void upload(slot, file);
                        }}
                      />
                      <Button
                        size="sm"
                        variant={id ? "outline" : "primary"}
                        isLoading={busy === slot}
                        disabled={busy !== null}
                        leftIcon={<Camera className="h-4 w-4" aria-hidden="true" />}
                        onClick={() => inputs.current[slot]?.click()}
                      >
                        {t(id ? "devices.photos.replace" : "devices.photos.add", { slot: slotName(slot) })}
                      </Button>
                      {id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          aria-label={t("devices.photos.delete", { slot: slotName(slot) })}
                          onClick={() => setConfirmDelete(slot)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  )}
                  {error?.slot === slot && (
                    <div role="alert">
                      <Alert variant="error" title={t("devices.photos.refusedTitle")}>
                        <p>{error.message}</p>
                      </Alert>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          <p role="status" className="text-sm">
            {complete ? t("devices.photos.complete") : t("devices.photos.incomplete")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {mode === "register" ? (
              <>
                <Button variant="outline" onClick={() => onClose(changed)}>
                  {t("devices.photos.later")}
                </Button>
                <Button disabled={!complete} onClick={() => onClose(changed)}>
                  {t("devices.photos.finish")}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => onClose(changed)}>
                {t("devices.photos.close")}
              </Button>
            )}
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title={t("devices.photos.deleteTitle")}
        description={confirmDelete ? t("devices.photos.deleteBody", { slot: slotName(confirmDelete), name: device.name }) : undefined}
        confirmLabel={t("devices.photos.deleteConfirm")}
        cancelLabel={t("devices.cancel")}
        variant="danger"
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
