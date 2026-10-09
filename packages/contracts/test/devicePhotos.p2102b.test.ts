/**
 * P21-02b (ADR-132 Am. 3; spec P19-03 § 7.2): the device photo routes' contracts and vocabulary.
 */
import { devicePhotoParams, devicePhotoUpload } from "@callibrator/contracts/calibrationDevices";
import { ATTACHMENT_PURPOSES, ATTACHMENT_VARIANTS, DEVICE_PHOTO_CODES, DEVICE_PHOTO_PURPOSES, DEVICE_PHOTO_TYPES, SINGLE_DEVICE_PHOTO_PURPOSES } from "@callibrator/contracts/deviceValues";

const DEVICE = "d1000000-0000-4000-8000-0000000000f1";
const PHOTO = "a7000000-0000-4000-8000-0000000000f1";

describe("devicePhotoUpload", () => {
  it("takes the three device purposes with the path's device", () => {
    for (const purpose of DEVICE_PHOTO_PURPOSES) {
      expect(devicePhotoUpload.parse({ calibrationDeviceId: DEVICE, purpose })).toEqual({ calibrationDeviceId: DEVICE, purpose });
    }
  });

  it("refuses an IPM purpose, a missing purpose, an unknown field and a malformed device id", () => {
    for (const bad of [
      { calibrationDeviceId: DEVICE, purpose: "ipm_evidence" },
      { calibrationDeviceId: DEVICE },
      { calibrationDeviceId: DEVICE, purpose: "device_front", clientFacilityId: DEVICE },
      { calibrationDeviceId: "nope", purpose: "device_front" },
    ]) {
      expect(devicePhotoUpload.safeParse(bad).success).toBe(false);
    }
  });
});

describe("devicePhotoParams", () => {
  it("both ids, strictly", () => {
    expect(devicePhotoParams.parse({ calibrationDeviceId: DEVICE, attachmentId: PHOTO })).toEqual({ calibrationDeviceId: DEVICE, attachmentId: PHOTO });
    expect(devicePhotoParams.safeParse({ calibrationDeviceId: DEVICE }).success).toBe(false);
    expect(devicePhotoParams.safeParse({ calibrationDeviceId: DEVICE, attachmentId: PHOTO, x: 1 }).success).toBe(false);
  });
});

describe("the vocabulary", () => {
  it("the device purposes are the attachment purposes less the IPM's; the single ones among them", () => {
    expect([...DEVICE_PHOTO_PURPOSES, "ipm_evidence"]).toEqual([...ATTACHMENT_PURPOSES]);
    expect(SINGLE_DEVICE_PHOTO_PURPOSES.every((p) => (DEVICE_PHOTO_PURPOSES as readonly string[]).includes(p))).toBe(true);
  });

  it("JPEG and PNG only (HEIC is converted on the client); three variants; six codes", () => {
    expect([...DEVICE_PHOTO_TYPES]).toEqual(["image/jpeg", "image/png"]);
    expect([...ATTACHMENT_VARIANTS]).toEqual(["original", "display", "thumb"]);
    expect(Object.values(DEVICE_PHOTO_CODES)).toEqual([
      "PHOTO_FILE_REQUIRED",
      "PHOTO_HEIC_UNSUPPORTED",
      "PHOTO_TYPE_UNSUPPORTED",
      "PHOTO_UNDECODABLE",
      "PHOTO_IMAGE_TOO_LARGE",
      "PHOTO_REJECTED_BY_SCAN",
    ]);
  });
});
