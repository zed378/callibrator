/**
 * The contract of `deviceTypes.route.ts`, code-first (ADR-103): the global inspection catalogue's
 * device types (P21-01; ADR-125; spec MEMORY/specs/P19-01-inspection-catalogue.md § 7.1, § 8.2).
 * Examples are synthetic.
 */
import { z } from "zod";
import {
  createDeviceType,
  deviceTypeIdParams,
  listDeviceTypesQuery,
  renameDeviceTypeBody,
} from "@callibrator/contracts/inspectionCatalogue";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { DeviceType } from "../../docs/openapi/inspectionCatalogueSchemas";

const params = z.object({
  deviceTypeId: deviceTypeIdParams.shape.deviceTypeId.meta({ description: "The device type's id", example: "d7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7" }),
});

const read = { kind: "dynamicAccess", resource: ["calibration", "ipm", "ipm-templates"], action: "read" } as const;
const operator = { kind: "superAdminOnly" } as const;
const OPERATOR = "The platform operator only (super admin; an API key is refused). Audited under the platform tenant.";

export default defineRouteDocs({
  router: "api/deviceTypes.route",
  mount: "/api/v1/device-types",
  tag: "Inspection Catalogue",
  tagDescription:
    "The global, versioned inspection catalogue (ADR-125): device types, the item library, checklist templates and their " +
    "versions, and the tenants' proposals. Written only by the platform operator; every published version is immutable.",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listDeviceTypes",
      summary: "List device types",
      description:
        "Any one of `calibration`, `ipm` or `ipm-templates` read. `status` is `active` by default; `retired` and `all` are open to " +
        "every reader (a device's retired type still resolves). By name, then id. Reachable by a facility-bound account (global content).",
      permission: read,
      audited: false,
      query: listDeviceTypesQuery,
      success: { status: 200, description: "A page of device types; pagination in the top-level `meta`", list: DeviceType },
    },
    {
      method: "get",
      path: "/:deviceTypeId",
      operationId: "getDeviceType",
      summary: "One device type",
      description: "Any status. Global content: every tenant reads the same row.",
      permission: read,
      audited: false,
      params,
      success: { status: 200, description: "The device type", data: DeviceType },
    },
    {
      method: "post",
      path: "/",
      operationId: "createDeviceType",
      summary: "Create a device type",
      description: `The name is unique over every status, case-insensitively; a retired name is reactivated, not recreated. ${OPERATOR}`,
      permission: operator,
      audited: true,
      body: createDeviceType,
      conflict: "A device type with that name exists (the message says when it is retired and should be reactivated).",
      success: { status: 201, description: "The new, active device type", data: DeviceType },
    },
    {
      method: "patch",
      path: "/:deviceTypeId",
      operationId: "renameDeviceType",
      summary: "Rename a device type",
      description: `An active type only. ${OPERATOR}`,
      permission: operator,
      audited: true,
      params,
      body: renameDeviceTypeBody,
      conflict: "The type is retired, or another type has the name.",
      success: { status: 200, description: "The device type", data: DeviceType },
    },
    {
      method: "post",
      path: "/:deviceTypeId/retire",
      operationId: "retireDeviceType",
      summary: "Retire a device type",
      description: `Devices keep it; it can no longer be given to a device (400 there). ${OPERATOR}`,
      permission: operator,
      audited: true,
      params,
      conflict: "The type is already retired.",
      success: { status: 200, description: "The device type", data: DeviceType },
    },
    {
      method: "post",
      path: "/:deviceTypeId/reactivate",
      operationId: "reactivateDeviceType",
      summary: "Reactivate a device type",
      description: OPERATOR,
      permission: operator,
      audited: true,
      params,
      conflict: "The type is active.",
      success: { status: 200, description: "The device type", data: DeviceType },
    },
  ],
});
