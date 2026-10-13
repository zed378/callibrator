/**
 * The public device page: `/api/v1/public/devices` (index.ts mounts it). P21-08 (ADR-138, Am. 1;
 * spec MEMORY/specs/P19-07-public-device-page.md § 7).
 *
 *  - `GET /:token` — PUBLIC (no `auth`; routeGateExemptions `public`): the sticker's link. The
 *    128-bit token is the capability; every failure is one identical 404. The answer's headers are
 *    set first (`no-store`, `noindex`, `no-referrer`), so a 429 carries them too; then every request
 *    counts against `publicDevicePage` (per address) and `publicDevicePageGlobal` (every address,
 *    one key); the controller counts every 404 against `publicDevicePageMiss` as well.
 *
 * Contract: publicDevices.openapi.ts.
 */
import { Router } from "express";
import { requestBudget } from "../../middlewares/requestBudget.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { publicDeviceParams } from "@callibrator/contracts/publicDevices";
import { publicHeaders, read } from "../../controllers/publicDevice.controller";

const router = Router();

router.get(
  "/:token",
  publicHeaders,
  requestBudget("publicDevicePage"),
  requestBudget("publicDevicePageGlobal", { perAddress: false, keyOf: () => "all" }),
  validate(publicDeviceParams, { from: "params" }),
  read,
);

export = router;
