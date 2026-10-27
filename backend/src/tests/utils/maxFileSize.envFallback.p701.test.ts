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
import { environment } from "../../config/env";
import type * as UploadUtil from "../../utils/upload.util";

const MB5 = 5 * 1024 * 1024;

const penv = environment();

/** Run `load` in a fresh module registry with MAX_FILE_SIZE set or unset. */
const withMaxFileSize = (value: string | undefined, load: () => void): void => {
  const saved = penv["MAX_FILE_SIZE"];
  if (value === undefined) {
    Reflect.deleteProperty(penv, "MAX_FILE_SIZE");
  } else {
    penv["MAX_FILE_SIZE"] = value;
  }
  try {
    jest.isolateModules(load);
  } finally {
    if (saved === undefined) {
      Reflect.deleteProperty(penv, "MAX_FILE_SIZE");
    } else {
      penv["MAX_FILE_SIZE"] = saved;
    }
  }
};

interface MulterDouble {
  (options: { limits: { fileSize: number } }): { single: jest.Mock; array: jest.Mock };
  diskStorage: jest.Mock;
  MulterError: new (message?: string) => Error;
}

describe("P7-01 MAX_FILE_SIZE: the configured value and the 5 MB fallback both apply", () => {
  afterEach(() => {
    jest.dontMock("multer");
    jest.dontMock("../../utils/upload.util");
  });

  describe("utils/upload.util.js — the module-wide default limit", () => {
    const defaultLimit = (value: string | undefined): number | undefined => {
      const limits: number[] = [];
      withMaxFileSize(value, () => {
        const multer = jest.fn((options: { limits: { fileSize: number } }) => {
          limits.push(options.limits.fileSize);
          return { single: jest.fn(), array: jest.fn() };
        }) as unknown as MulterDouble;
        multer.diskStorage = jest.fn(() => ({}));
        multer.MulterError = class MulterError extends Error { };
        jest.doMock("multer", () => multer);
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-reads the module under a mocked multer
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
    const logoLimits = (value: string | undefined): number[] => {
      const limits: number[] = [];
      withMaxFileSize(value, () => {
        jest.doMock("../../utils/upload.util", () => ({
          ...jest.requireActual<typeof UploadUtil>("../../utils/upload.util"),
          upload: (options: { maxFileSize?: number }) => {
            limits.push(options.maxFileSize as number);
            return (_req: unknown, _res: unknown, next: () => void): void => {
              next();
            };
          },
        }));
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-reads the route under the stubbed upload
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
