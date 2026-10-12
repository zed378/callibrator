/**
 * P22-10c2 — the local catalogue as the field screens read it: the published version of a device
 * type, or by id. Nothing from the IPM contracts here: the device and register screens are in the
 * `/field` first load (ADR-127 Am. 4); the item order lives with the capture (`captureState.ts`).
 */
import type { PublishedCatalogue } from "../fieldStore";

export type PublishedVersion = PublishedCatalogue["versions"][number];
export type CatalogueItem = PublishedVersion["items"][number];

/** The published version for a device type (null: no checklist for it — `IPM_NO_CHECKLIST`). */
export const versionFor = (catalogue: PublishedCatalogue | null, deviceTypeId: string | null): PublishedVersion | null =>
  (deviceTypeId !== null && catalogue?.versions.find((v) => v.deviceTypeId === deviceTypeId)) || null;

export const versionById = (catalogue: PublishedCatalogue | null, id: string | null): PublishedVersion | null =>
  (id !== null && catalogue?.versions.find((v) => v.id === id)) || null;
