/**
 * P7-01 / ADR-082 — coverage must not depend on the developer's `.env`.
 *
 * jest.config.js loads backend/.env into every worker. On the workstation
 * that file has no MAX_FILE_SIZE, so `parseInt(process.env.MAX_FILE_SIZE) ||
 * 5 MB` only ever took its FALLBACK; in CI the file is a copy of
 * .env.example, which sets MAX_FILE_SIZE=10485760, so only the OTHER side ran
 * — and the backend-test job, run in its CI form for the first time on
 * 2026-09-28, failed the 100% branch gate on tenant.route.js (389, 550, 802)
 * and upload.util.js (223). This pins both sides of every one of those
 * expressions, whatever `.env` holds.
 */

const MB5 = 5 * 1024 * 1024;

/** Run `load` in a fresh module registry with MAX_FILE_SIZE set or unset. */
const withMaxFileSize = (value, load) => {
  const saved = process.env.MAX_FILE_SIZE;
  if (value === undefined) {
    delete process.env.MAX_FILE_SIZE;
  } else {
    process.env.MAX_FILE_SIZE = value;
  }
  try {
    jest.isolateModules(load);
  } finally {
    if (saved === undefined) {
      delete process.env.MAX_FILE_SIZE;
    } else {
      process.env.MAX_FILE_SIZE = saved;
    }
  }
};

describe("P7-01 MAX_FILE_SIZE: the configured value and the 5 MB fallback both apply", () => {
  afterEach(() => {
    jest.dontMock("multer");
    jest.dontMock("../../utils/upload.util");
  });

  describe("utils/upload.util.js — the module-wide default limit", () => {
    const defaultLimit = (value) => {
      const limits = [];
      withMaxFileSize(value, () => {
        const multer = jest.fn((options) => {
          limits.push(options.limits.fileSize);
          return { single: jest.fn(), array: jest.fn() };
        });
        multer.diskStorage = jest.fn(() => ({}));
        multer.MulterError = class MulterError extends Error {};
        jest.doMock("multer", () => multer);
        require("../../utils/upload.util");
      });
      // The first multer() call is the module-level instance.
      return limits[0];
    };

    it("uses MAX_FILE_SIZE when it is set", () => {
      expect(defaultLimit("1234")).toBe(1234);
    });

    it("falls back to 5 MB when it is unset", () => {
      expect(defaultLimit(undefined)).toBe(MB5);
    });
  });

  describe("routes/api/tenant.route.js — the three logo uploads", () => {
    const logoLimits = (value) => {
      const limits = [];
      withMaxFileSize(value, () => {
        jest.doMock("../../utils/upload.util", () => ({
          ...jest.requireActual("../../utils/upload.util"),
          upload: (options) => {
            limits.push(options.maxFileSize);
            return (req, res, next) => next();
          },
        }));
        require("../../routes/api/tenant.route");
      });
      return limits;
    };

    it("uses MAX_FILE_SIZE when it is set", () => {
      const limits = logoLimits("4321");
      expect(limits).toHaveLength(3);
      expect(limits.every((limit) => limit === 4321)).toBe(true);
    });

    it("falls back to 5 MB when it is unset", () => {
      const limits = logoLimits(undefined);
      expect(limits).toHaveLength(3);
      expect(limits.every((limit) => limit === MB5)).toBe(true);
    });
  });
});
