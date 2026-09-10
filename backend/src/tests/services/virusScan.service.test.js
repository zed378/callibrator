jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../services/clamAv.service", () => ({
  scanFile: jest.fn(),
}));

const { scanFile } = require("../../services/virusScan.service");
const clamav = require("../../services/clamAv.service");
const { logger } = require("../../middlewares/activityLog.middleware");

describe("virusScan.service", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.VIRUS_SCAN_PROVIDER;
    delete process.env.VIRUS_SCAN_FAIL_OPEN;
  });

  afterAll(() => {
    process.env = { ...origEnv };
  });

  describe("provider=none", () => {
    it("passes every file through by default", async () => {
      const result = await scanFile("/uploads/file.pdf");
      expect(result).toEqual({ clean: true, provider: "none" });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("passes through when explicitly set to none", async () => {
      process.env.VIRUS_SCAN_PROVIDER = "none";
      const result = await scanFile("/uploads/file.pdf");
      expect(result).toEqual({ clean: true, provider: "none" });
    });
  });

  describe("provider=clamav", () => {
    beforeEach(() => {
      process.env.VIRUS_SCAN_PROVIDER = "clamav";
    });

    it("returns clean when ClamAV reports the file clean", async () => {
      clamav.scanFile.mockResolvedValue({ isClean: true, code: "OK" });
      const result = await scanFile("/uploads/ok.pdf");
      expect(result).toEqual({ clean: true, provider: "clamav", reason: "OK" });
    });

    it("rejects an infected file with the scanner's result", async () => {
      clamav.scanFile.mockResolvedValue({ isClean: false, result: "Eicar-Test-Signature FOUND" });
      const result = await scanFile("/uploads/evil.exe");
      expect(result).toEqual({
        clean: false,
        provider: "clamav",
        reason: "Eicar-Test-Signature FOUND",
      });
    });

    it("defaults the infected reason when the scanner gives none", async () => {
      clamav.scanFile.mockResolvedValue({ isClean: false });
      const result = await scanFile("/uploads/evil.exe");
      expect(result.reason).toBe("infected");
    });

    it("fails CLOSED when the scanner errors (default)", async () => {
      clamav.scanFile.mockRejectedValue(new Error("clamd unreachable"));
      const result = await scanFile("/uploads/x.pdf");
      expect(result.clean).toBe(false);
      expect(result.reason).toContain("scan-error");
      expect(logger.error).toHaveBeenCalled();
    });

    it("fails OPEN on scanner error when VIRUS_SCAN_FAIL_OPEN=true", async () => {
      process.env.VIRUS_SCAN_FAIL_OPEN = "true";
      clamav.scanFile.mockRejectedValue(new Error("clamd unreachable"));
      const result = await scanFile("/uploads/x.pdf");
      expect(result.clean).toBe(true);
      expect(result.reason).toContain("scan-error-allowed");
    });
  });

  describe("unknown provider", () => {
    it("fails CLOSED by default", async () => {
      process.env.VIRUS_SCAN_PROVIDER = "mystery";
      const result = await scanFile("/uploads/x.pdf");
      expect(result).toEqual({
        clean: false,
        provider: "mystery",
        reason: "provider-not-implemented",
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("passes through when VIRUS_SCAN_FAIL_OPEN=true", async () => {
      process.env.VIRUS_SCAN_PROVIDER = "mystery";
      process.env.VIRUS_SCAN_FAIL_OPEN = "true";
      const result = await scanFile("/uploads/x.pdf");
      expect(result.clean).toBe(true);
    });
  });
});
