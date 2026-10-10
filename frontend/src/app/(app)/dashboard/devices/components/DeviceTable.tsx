"use client";

/**
 * P22-02 (F-29, F-30; P19-03 § 8.3) — the register's rows: the front photo's thumbnail (a signed
 * link, never a permanent URL), the device with its QR and serial, type, make · model, facility
 * (provider staff only), room · floor, condition, status, the photos' completeness and the next
 * calibration with its due state. Actions are named after their device.
 */
import React from "react";
import Link from "next/link";
import { Camera, ClipboardCheck, Edit, ImageOff, Radio, Trash2 } from "lucide-react";
import { Button, StatusBadge } from "@/components/ui";
import type { RegisterDevice } from "@/api/services/deviceRegister.service";
import { PhotoThumb } from "./PhotoThumb";
import { useDeviceText } from "./shared";

export interface RowActions {
  /** Photos can be managed (`calibration` write, not the platform operator). */
  photos: boolean;
  /** P22-04 (F-57): the device's IPM history (`ipm` read). */
  ipm: boolean;
  edit: boolean;
  remove: boolean;
  iot: boolean;
}

interface Props {
  rows: RegisterDevice[];
  showFacility: boolean;
  actions: RowActions;
  onPhotos: (device: RegisterDevice) => void;
  onEdit: (device: RegisterDevice) => void;
  onDelete: (device: RegisterDevice) => void;
  onIot: (device: RegisterDevice) => void;
}

const where = (d: RegisterDevice): string => {
  const w = d.warehouse;
  if (!w) return "—";
  return [w.name, w.floor].filter((v) => v !== null && v !== undefined && v !== "").join(" · ");
};

export function DeviceTable({ rows, showFacility, actions, onPhotos, onEdit, onDelete, onIot }: Props) {
  const text = useDeviceText();
  const { t } = text;
  return (
    // `relative` (2026-10-11): the sr-only caption and header labels are absolutely positioned. In a
    // scroller that is not their containing block they escape it, and the actions header's label sat
    // at the table's right edge: the page laid out 823 px wide in a 683 px viewport (WCAG 1.4.10,
    // automate/a11y.browser.js reflow at 200% zoom).
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("devices.list.caption")}</caption>
        <thead className="text-left">
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">{t("devices.col.photo")}</span>
            </th>
            <th scope="col" className="px-3 py-2 font-medium">{t("devices.col.device")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("devices.col.type")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("devices.col.make")}</th>
            {showFacility && <th scope="col" className="px-3 py-2 font-medium">{t("devices.col.facility")}</th>}
            <th scope="col" className="px-3 py-2 font-medium">{t("devices.col.location")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("devices.col.condition")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("devices.col.status")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("devices.col.next")}</th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">{t("devices.col.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const make = [d.manufacturer, d.model].filter(Boolean).join(" · ");
            const due = d.calibrationDue;
            return (
              <tr key={d.id} className="border-b border-border last:border-0 align-top">
                <td className="px-3 py-2">
                  {d.frontPhotoAttachmentId ? (
                    <PhotoThumb
                      attachmentId={d.frontPhotoAttachmentId}
                      alt={t("devices.photos.alt", { slot: t("devices.photos.device_front"), name: d.name })}
                      unavailable={t("devices.photos.unavailable")}
                    />
                  ) : (
                    <span
                      role="img"
                      aria-label={t("devices.photos.noneFor", { name: d.name })}
                      className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground"
                    >
                      <ImageOff className="h-4 w-4" aria-hidden="true" />
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className="font-semibold text-foreground">{d.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{d.qrCode ?? t("devices.list.noQr")}</span>
                  {d.serialNumber && <span className="block font-mono text-xs text-muted-foreground">{t("devices.list.serial", { serial: d.serialNumber })}</span>}
                  {d.photosComplete === false && <span className="mt-1 block text-xs text-muted-foreground">{t("devices.list.photosMissing")}</span>}
                </td>
                <td className="px-3 py-2">{d.deviceType?.name ?? d.category ?? "—"}</td>
                <td className="px-3 py-2">{make || "—"}</td>
                {showFacility && <td className="px-3 py-2">{d.clientFacility?.name ?? "—"}</td>}
                <td className="px-3 py-2">{where(d)}</td>
                <td className="px-3 py-2">
                  {d.condition ? (
                    <StatusBadge domain="deviceCondition" state={d.condition} size="sm">
                      {text.condition(d.condition)}
                    </StatusBadge>
                  ) : (
                    <span className="text-muted-foreground">{text.condition(null)}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge domain="device" state={d.status ?? "active"} size="sm">
                    {text.status(d.status)}
                  </StatusBadge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="block">{text.date(due?.nextCalibrationDate ?? d.nextCalibrationDate)}</span>
                  {due && due.state !== "ok" && due.state !== "not_scheduled" && (
                    <StatusBadge domain="calibrationDue" state={due.state} size="sm">
                      {text.due(due.state)}
                    </StatusBadge>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    {actions.photos && (
                      <Button variant="ghost" size="sm" aria-label={t("devices.action.photos", { name: d.name })} onClick={() => onPhotos(d)}>
                        <Camera className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                    {actions.ipm && (
                      <Link
                        href={`/dashboard/ipm?deviceId=${encodeURIComponent(d.id)}`}
                        aria-label={t("devices.action.ipm", { name: d.name })}
                        className="inline-flex h-8 items-center justify-center rounded-md px-2 text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    )}
                    {actions.iot && (
                      <Button variant="ghost" size="sm" aria-label={t("devices.action.iot", { name: d.name })} onClick={() => onIot(d)}>
                        <Radio className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                    {actions.edit && (
                      <Button variant="ghost" size="sm" aria-label={t("devices.action.edit", { name: d.name })} onClick={() => onEdit(d)}>
                        <Edit className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                    {actions.remove && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("devices.action.delete", { name: d.name })}
                        className="text-destructive hover:text-destructive"
                        onClick={() => onDelete(d)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
