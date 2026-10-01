/**
 * P9-22 (ADR-097) — the constants that became canonical in the package are
 * the SAME bindings the backend's constants modules export: `===`, not equal.
 * A backend module that stops re-exporting and declares its own copy fails
 * here, which is the drift this move exists to prevent.
 */
import * as pagination from "@callibrator/contracts/pagination";
import * as qmsValues from "@callibrator/contracts/qmsValues";
import * as tenantLogo from "@callibrator/contracts/tenantLogo";
import * as accessRequestValues from "@callibrator/contracts/accessRequestValues";
import * as backendAccessRequest from "../../../backend/src/constants/accessRequest";
import * as appConstants from "../../../backend/src/constants/appConstants";
import * as constantsBarrel from "../../../backend/src/constants";
import * as backendQms from "../../../backend/src/constants/qmsConstants";
import * as backendLogo from "../../../backend/src/constants/tenantLogo";

describe("constants canonical in @callibrator/contracts", () => {
  it("pagination: appConstants and the constants barrel re-export the package's values", () => {
    expect(appConstants.DEFAULT_LIMIT).toBe(pagination.DEFAULT_LIMIT);
    expect(appConstants.MAX_LIMIT).toBe(pagination.MAX_LIMIT);
    expect(constantsBarrel.DEFAULT_LIMIT).toBe(25);
    expect(constantsBarrel.MAX_LIMIT).toBe(200);
  });

  it("qms: the same frozen arrays, by identity", () => {
    expect(backendQms.NC_STATUSES).toBe(qmsValues.NC_STATUSES);
    expect(backendQms.NC_SEVERITIES).toBe(qmsValues.NC_SEVERITIES);
    expect(backendQms.CAPA_STATUSES).toBe(qmsValues.CAPA_STATUSES);
    for (const list of [qmsValues.NC_STATUSES, qmsValues.NC_SEVERITIES, qmsValues.CAPA_STATUSES]) {
      expect(Object.isFrozen(list)).toBe(true);
    }
  });

  it("tenant logo: the same RegExp object", () => {
    expect(backendLogo.STORED_LOGO_NAME).toBe(tenantLogo.STORED_LOGO_NAME);
    expect(tenantLogo.STORED_LOGO_NAME.test("1727-1-3f2a.png")).toBe(true);
    expect(tenantLogo.STORED_LOGO_NAME.test("https://x.test/a.png")).toBe(false);
  });

  it("access-request vocabularies: the same arrays, by identity", () => {
    expect(backendAccessRequest.FACILITY_TYPES).toBe(accessRequestValues.FACILITY_TYPES);
    expect(backendAccessRequest.DEVICE_COUNT_BANDS).toBe(accessRequestValues.DEVICE_COUNT_BANDS);
    expect(backendAccessRequest.REQUEST_LOCALES).toBe(accessRequestValues.REQUEST_LOCALES);
    expect(backendAccessRequest.ACCESS_REQUEST_STATUSES).toBe(accessRequestValues.ACCESS_REQUEST_STATUSES);
  });
});
