/**
 * P10-03 (doc 20 §6.1, §6.3, §12): the product screenshots on the landing.
 * Re-captured 2026-10-05 (P10-17, QA M4) from the warm build in LIGHT theme on
 * the p1017warm stack's demo tenant (`seed-demo` + seven invented CONTOH-*
 * devices); the browser suite's own test rows are left out of the picture.
 * Captured from a seeded DEMO tenant with invented devices — no real hospital,
 * patient or staff names — and captioned "Contoh data / Sample data" wherever
 * they appear. Each file has a row in the asset register (doc 20 §12), which
 * src/tests/copyTruthfulness.p1011.test.ts enforces for public/marketing/.
 */
import type { MessageKey } from "@/i18n";

export interface ProductShot {
  src: string;
  width: number;
  height: number;
  altKey: MessageKey;
}

export const PRODUCT_SHOTS = {
  device: { src: "/marketing/product/step-device.webp", width: 1280, height: 800, altKey: "landing.shot.device" },
  schedule: { src: "/marketing/product/step-schedule.webp", width: 1280, height: 800, altKey: "landing.shot.schedule" },
  calibrate: { src: "/marketing/product/step-calibrate.webp", width: 1280, height: 800, altKey: "landing.shot.calibrate" },
  certificate: {
    src: "/marketing/product/step-certificate.webp",
    width: 1280,
    height: 800,
    altKey: "landing.shot.certificate",
  },
  sign: { src: "/marketing/product/step-sign.webp", width: 760, height: 1127, altKey: "landing.shot.sign" },
  verify: { src: "/marketing/product/step-verify.webp", width: 780, height: 1688, altKey: "landing.verify.phoneLabel" },
} as const satisfies Record<string, ProductShot>;
