/**
 * @callibrator/contracts — the request schemas the backend validates with and
 * the frontend derives its request types from (P9-22, ADR-097; ADR-038's
 * shared-contracts row).
 *
 * One module per domain, importable directly (`@callibrator/contracts/vendor`)
 * or through this barrel. The barrel holds the first slice and the shared
 * data modules only; every domain moved after it is imported by its subpath,
 * because domain modules reuse names (`calibrationDeviceIdSchema` is in both
 * `calibrationDevices` and `calibrationRecords`, `updateRoleSchema` in both
 * `user` and `roles`) and one flat namespace would force renames. A module holds schemas and the types derived from
 * them, and imports nothing but `zod` and its siblings: no backend or frontend
 * code, no Node or DOM API, because both ends load it.
 */
//
// Named re-exports, not `export *`: the CommonJS interop Babel and TypeScript
// emit for `export *` is a loop with branches the 100% coverage gate counts.
export {
  booleanish,
  caseless,
  dateLike,
  email,
  isoDate,
  isoDateText,
  jsonObject,
  nullableText,
  numeric,
  optionalText,
  uuid,
} from "./fields";
export { VENDOR_STATUSES, VENDOR_TYPES, createVendor, qualifyVendor, updateVendor } from "./vendor";
export type {
  CreateVendorBody,
  CreateVendorInput,
  QualifyVendorBody,
  QualifyVendorInput,
  UpdateVendorBody,
  UpdateVendorInput,
  VendorStatus,
  VendorType,
} from "./vendor";
export {
  DEVICE_STATUSES,
  calibrationDeviceIdSchema,
  createCalibrationDeviceSchema,
  getCalibrationDevicesQuery,
  updateCalibrationDeviceSchema,
} from "./calibrationDevices";
export type {
  CreateCalibrationDeviceBody,
  CreateCalibrationDeviceInput,
  DeviceStatus,
  GetCalibrationDevicesQueryInput,
  UpdateCalibrationDeviceBody,
  UpdateCalibrationDeviceInput,
} from "./calibrationDevices";
export { API_KEY_SCOPE_ACTIONS, API_KEY_SCOPE_RESOURCES, apiKeyScope } from "./apiKeyScopes";
export type { ApiKeyScopeAction, ApiKeyScopeResource } from "./apiKeyScopes";
export { CONTENT_HTML_IMAGE_SCHEMES, CONTENT_HTML_LINK_SCHEMES, contentHtmlPolicy } from "./contentHtml";
export type { ContentHtmlPolicy } from "./contentHtml";
