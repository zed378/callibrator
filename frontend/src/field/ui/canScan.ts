/**
 * P22-10c2 — whether this browser can scan with the camera (the browser's `BarcodeDetector` and a
 * camera), read without loading the scanner itself (its dialog loads on demand). The same test as
 * P22-03's `QrScanner.canScan`.
 */
export const canScan = (): boolean =>
  typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector === "function" &&
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getUserMedia === "function";
