/**
 * F-19 — calibrationStore kept ONE `isLoading` / `error` for its three lists
 * (records, certificates, certificate stats) and every mutation:
 *  - while the stats loaded, the records table read `isLoading` and a list
 *    already on screen flashed its skeleton/empty state;
 *  - a certificates fetch started with `error: null`, wiping a records read's
 *    failure (and the reverse), so a failed list could look merely empty.
 *
 * Each list now has its own read state in `lists[name]`; mutations and
 * single-record reads keep the shared pair. The service is mocked: this proves
 * the store's behaviour, not the endpoint.
 */
const calibrationService = {
  getAll: jest.fn(),
  getAllCertificates: jest.fn(),
  getCertificateStats: jest.fn(),
  create: jest.fn(),
};
jest.mock("@/api/services/calibration.service", () => ({ calibrationService }));

import { useCalibrationStore, type CalibrationList } from "../calibrationStore";

const idle = { isLoading: false, error: null };
const page = { data: [{ id: "x" }], meta: { page: 1, limit: 10, totalPages: 1, total: 1 } };

/** A promise the test resolves or rejects by hand. */
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  Object.values(calibrationService).forEach((m) => m.mockReset());
  useCalibrationStore.setState({
    calibrations: null,
    certificates: null,
    certificateStats: null,
    isLoading: false,
    error: null,
    lists: { calibrations: idle, certificates: idle, certificateStats: idle },
  });
});

const lists = () => useCalibrationStore.getState().lists;

describe("calibrationStore — each list has its own read state (F-19)", () => {
  const cases: {
    list: CalibrationList;
    run: () => Promise<void>;
    method: keyof typeof calibrationService;
    resolved: unknown;
    fallback: string;
  }[] = [
    {
      list: "calibrations",
      run: () => useCalibrationStore.getState().fetchCalibrations(2, 5, "d1", true, "a", "b"),
      method: "getAll",
      resolved: page,
      fallback: "Failed to fetch calibration records",
    },
    {
      list: "certificates",
      run: () => useCalibrationStore.getState().fetchCertificates(1, 10, "d1", ["draft"], ["calibration"], "C-1", "a", "b"),
      method: "getAllCertificates",
      resolved: page,
      fallback: "Failed to fetch certificates",
    },
    {
      list: "certificateStats",
      run: () => useCalibrationStore.getState().fetchCertificateStats(),
      method: "getCertificateStats",
      resolved: { totalCertificates: 3 },
      fallback: "Failed to fetch certificate statistics",
    },
  ];

  it.each(cases)("$list: success stores the rows and leaves its read state idle", async ({ list, run, method, resolved }) => {
    calibrationService[method].mockResolvedValue(resolved);
    await run();
    expect(useCalibrationStore.getState()[list]).toEqual(resolved);
    expect(lists()[list]).toEqual(idle);
  });

  it.each(cases)("$list: a failure is that list's error, with the backend's message or the fallback", async ({ list, run, method, fallback }) => {
    calibrationService[method].mockRejectedValueOnce(new Error("backend says no"));
    await run();
    expect(lists()[list]).toEqual({ isLoading: false, error: "backend says no" });

    calibrationService[method].mockRejectedValueOnce("not an Error");
    await run();
    expect(lists()[list]).toEqual({ isLoading: false, error: fallback });
    expect(useCalibrationStore.getState().error).toBeNull();
  });

  it("F-19: a certificates fetch does not wipe a failed records read", async () => {
    calibrationService.getAll.mockRejectedValue(new Error("Records are unavailable"));
    await useCalibrationStore.getState().fetchCalibrations();
    calibrationService.getAllCertificates.mockResolvedValue(page);
    await useCalibrationStore.getState().fetchCertificates();

    expect(lists().calibrations.error).toBe("Records are unavailable");
    expect(lists().certificates).toEqual(idle);
  });

  it("F-19: while the stats load, the records list is not loading", async () => {
    calibrationService.getAll.mockResolvedValue(page);
    await useCalibrationStore.getState().fetchCalibrations();

    const stats = deferred<unknown>();
    calibrationService.getCertificateStats.mockReturnValue(stats.promise);
    const pending = useCalibrationStore.getState().fetchCertificateStats();

    expect(lists().certificateStats.isLoading).toBe(true);
    expect(lists().calibrations.isLoading).toBe(false);
    expect(useCalibrationStore.getState().isLoading).toBe(false);

    stats.resolve({ totalCertificates: 1 });
    await pending;
    expect(lists().certificateStats).toEqual(idle);
  });

  it("F-19: a failed mutation is the shared error, never a list's", async () => {
    calibrationService.create.mockRejectedValue(new Error("Device is retired"));
    await expect(useCalibrationStore.getState().createCalibration({ deviceId: "d1" } as never)).rejects.toThrow();
    expect(useCalibrationStore.getState().error).toBe("Device is retired");
    expect(lists().calibrations).toEqual(idle);
  });
});
