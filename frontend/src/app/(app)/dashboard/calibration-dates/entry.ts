/**
 * P22-05 — the quick entry's form, as plain data: the checks the form runs before saving (the
 * server's own rules of P19-05 § 7.3, so a technician sees them before a round trip; the server
 * still decides), and the request body built from the form and the device it was looked up for.
 */
import type { CalibrationDateBody, Device } from "@/api/services/calibrationDates.service";

/** Where the laboratory comes from: the device's own, one picked from the list, or typed. */
export type LabMode = "device" | "list" | "typed";
/** The laboratory's verdict: not stated (omitted), compliant, not compliant. */
export type Verdict = "unstated" | "compliant" | "non_compliant";

export interface EntryForm {
  calibrationDate: string;
  labMode: LabMode;
  vendorId: string;
  labName: string;
  certificateNumber: string;
  dueDate: string;
  verdict: Verdict;
  roomName: string;
  roomFloor: string;
  notes: string;
}

/** The problems the form can find; each is a message key under `calibrationDates.problem.`. */
export type EntryProblem = "dateMissing" | "dateFuture" | "dateTooOld" | "dueNotAfter" | "labMissing" | "floorWithoutRoom";

/** The earliest calibration date the server accepts (P19-05 § 7.3). */
export const EARLIEST_DAY = "1990-01-01";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today in the browser's zone, as `YYYY-MM-DD` (the date input's own format). */
export const todayDay = (now: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** The device's current room, when its location is a room (a store is not a room). */
export const deviceRoom = (device: Device): { name: string; floor: string } | null => {
  const w = device.warehouse;
  if (!w || w.kind === "store") return null;
  return { name: w.name, floor: w.floor ?? "" };
};

/** The laboratory the form starts on: the device's own when it has one, else the list or typing. */
export const initialLabMode = (device: Device, canPickLab: boolean): LabMode =>
  device.calibrationVendorId ? "device" : canPickLab ? "list" : "typed";

/** A fresh form for a device: today, its laboratory, its room confirmed as it is. */
export const emptyForm = (device: Device, canPickLab: boolean, today: string = todayDay()): EntryForm => {
  const room = deviceRoom(device);
  return {
    calibrationDate: today,
    labMode: initialLabMode(device, canPickLab),
    vendorId: "",
    labName: "",
    certificateNumber: "",
    dueDate: "",
    verdict: "unstated",
    roomName: room?.name ?? "",
    roomFloor: room?.floor ?? "",
    notes: "",
  };
};

/** What would stop the save, in the order the form shows it. */
export const entryProblems = (form: EntryForm, today: string = todayDay()): EntryProblem[] => {
  const problems: EntryProblem[] = [];
  const date = form.calibrationDate;
  if (!DAY.test(date)) problems.push("dateMissing");
  else if (date > today) problems.push("dateFuture");
  else if (date < EARLIEST_DAY) problems.push("dateTooOld");
  if (form.dueDate && DAY.test(date) && form.dueDate <= date) problems.push("dueNotAfter");
  const lab =
    form.labMode === "device" ? true : form.labMode === "list" ? form.vendorId !== "" : form.labName.trim() !== "";
  if (!lab) problems.push("labMissing");
  if (form.roomFloor.trim() && !form.roomName.trim()) problems.push("floorWithoutRoom");
  return problems;
};

/**
 * The request body. The room: the device's own location when the room was confirmed unchanged
 * (`locationId`), the typed room when it was changed (found or created in the device's facility),
 * nothing when there is none. Blank optional fields are left out, never sent empty.
 */
export const buildBody = (form: EntryForm, device: Device): CalibrationDateBody => {
  const body: CalibrationDateBody = { calibrationDate: form.calibrationDate };
  if (form.labMode === "device" && device.calibrationVendorId) body.calibrationVendorId = device.calibrationVendorId;
  if (form.labMode === "list" && form.vendorId) body.calibrationVendorId = form.vendorId;
  if (form.labMode === "typed" && form.labName.trim()) body.externalLabName = form.labName.trim();
  if (form.certificateNumber.trim()) body.certificateNumber = form.certificateNumber.trim();
  if (form.dueDate) body.dueDate = form.dueDate;
  if (form.verdict !== "unstated") body.isCompliant = form.verdict === "compliant";

  const current = deviceRoom(device);
  const name = form.roomName.trim();
  const floor = form.roomFloor.trim();
  if (current && device.locationId && name === current.name.trim() && floor === current.floor.trim()) {
    body.locationId = device.locationId;
  } else if (name) {
    body.room = { name, floor: floor || null };
  }

  if (form.notes.trim()) body.notes = form.notes.trim();
  return body;
};
