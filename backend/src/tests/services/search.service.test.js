jest.mock("../../config", () => ({ db: { query: jest.fn() } }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const search = require("../../services/search.service");
const { db } = require("../../config");

describe("search.service", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns empty for a blank query without querying", async () => {
    const r = await search.search("t1", { q: "   " });
    expect(r.total).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("runs FTS across types and merges results ranked by relevance", async () => {
    db.query
      .mockResolvedValueOnce([{ id: "d1", name: "X", rank: 0.5 }]) // device
      .mockResolvedValueOnce([{ id: "s1", itemName: "Y", rank: 0.9 }]) // stock
      .mockResolvedValueOnce([]); // certificate
    const r = await search.search("t1", { q: "widget" });
    expect(r.total).toBe(2);
    expect(r.results[0].id).toBe("s1"); // higher rank first
    expect(r.results[0].type).toBe("stock");
  });

  it("falls back to ILIKE when the FTS query throws", async () => {
    db.query
      .mockRejectedValueOnce(new Error("column search_vector does not exist"))
      .mockResolvedValueOnce([{ id: "d1", name: "X", rank: 0 }]);
    const r = await search.search("t1", { q: "widget", types: ["device"] });
    expect(r.total).toBe(1);
    expect(db.query).toHaveBeenCalledTimes(2); // FTS then ILIKE
  });

  it("restricts to requested types", async () => {
    db.query.mockResolvedValueOnce([{ id: "s1", itemName: "Y", rank: 0.1 }]);
    const r = await search.search("t1", { q: "widget", types: ["stock"] });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(r.byType.stock).toBeDefined();
  });

  // A-56. This was "degrades to no results for a type when BOTH FTS and ILIKE
  // fail" — it pinned the defect: a broken statement rendered as "no results".
  it("A-56: fails the search with a non-operational 500 when BOTH FTS and ILIKE fail, logging both causes", async () => {
    const { logger } = require("../../middlewares/activityLog.middleware");
    db.query
      .mockRejectedValueOnce(new Error("column search_vector does not exist"))
      .mockRejectedValueOnce(new Error("permission denied for table calibration_devices"));

    const err = await search
      .search("t1", { q: "widget", types: ["device"] })
      .then(() => null, (e) => e);

    expect(err).not.toBeNull();
    expect(err.status).toBe(500);
    // Non-operational: the production error path shows the generic message
    // and the request id, never the SQL error text.
    expect(err.isOperational).toBe(false);
    expect(err.message).toBe("Search failed for device");
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      "Search failed for calibration_devices",
      expect.objectContaining({
        type: "device",
        ftsError: "column search_vector does not exist",
        ilikeError: "permission denied for table calibration_devices",
      }),
    );
  });

  it("A-56: one failing type fails the whole search instead of returning the others as a complete answer", async () => {
    db.query.mockImplementation(async (sql) =>
      sql.includes('"certificates"')
        ? Promise.reject(new Error("boom"))
        : [{ id: "x", rank: 0.1 }],
    );

    await expect(search.search("t1", { q: "widget" })).rejects.toMatchObject({
      status: 500,
      message: "Search failed for certificate",
    });
  });

  it("A-23: runs the per-type queries concurrently, not one after another", async () => {
    // Every query is held open until all three have been issued. Sequential
    // execution would issue only the first and then wait forever on it.
    const pending = [];
    db.query.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );

    const run = search.search("t1", { q: "widget" });
    await new Promise((r) => setImmediate(r));

    expect(db.query).toHaveBeenCalledTimes(3);
    pending.forEach((resolve) => resolve([]));
    await expect(run).resolves.toMatchObject({ total: 0 });
  });

  it("A-23: a duplicated type is searched once", async () => {
    db.query.mockResolvedValue([{ id: "d1", name: "X", rank: 0.3 }]);

    const r = await search.search("t1", { q: "widget", types: ["device", "device"] });

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(r.total).toBe(1);
  });

  it("A-23: warns about the ILIKE fallback once per table per process, then logs at debug", async () => {
    // A fresh module instance, so the once-per-process memory starts empty
    // whatever order the tests above ran in.
    // The mocked config and logger are re-created in the isolated registry,
    // so they are taken from it too.
    let fresh;
    let freshDb;
    let logger;
    jest.isolateModules(() => {
      fresh = require("../../services/search.service");
      freshDb = require("../../config").db;
      ({ logger } = require("../../middlewares/activityLog.middleware"));
    });
    freshDb.query.mockImplementation(async (sql) => {
      if (sql.includes("search_vector")) {
        throw new Error("column search_vector does not exist");
      }
      return [];
    });

    await fresh.search("t1", { q: "widget", types: ["stock"] });
    await fresh.search("t1", { q: "widget", types: ["stock"] });
    await fresh.search("t1", { q: "widget", types: ["stock"] });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/FTS unavailable for stocks/);
    expect(logger.debug).toHaveBeenCalledTimes(2);

    // A different table still gets its own single warning.
    await fresh.search("t1", { q: "widget", types: ["device"] });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("applies the default limit when none is given", async () => {
    db.query.mockResolvedValue([]);

    await search.search("t1", { q: "widget", types: ["stock"] });

    // limit = 10 comes from the destructuring default.
    const [, opts] = db.query.mock.calls[0];
    expect(opts.replacements.limit).toBe(10);
  });

  it("clamps a non-numeric limit to the default and caps it at 50", async () => {
    db.query.mockResolvedValue([]);

    await search.search("t1", { q: "a", types: ["stock"], limit: "abc" });
    expect(db.query.mock.calls[0][1].replacements.limit).toBe(10);

    db.query.mockClear();
    await search.search("t1", { q: "a", types: ["stock"], limit: 999 });
    expect(db.query.mock.calls[0][1].replacements.limit).toBe(50);

    db.query.mockClear();
    await search.search("t1", { q: "a", types: ["stock"], limit: 0 });
    expect(db.query.mock.calls[0][1].replacements.limit).toBe(10);
  });

  it("ignores unknown types and searches all types only when none are given", async () => {
    db.query.mockResolvedValue([]);

    await search.search("t1", { q: "a", types: ["nope"] });
    // An all-unknown filter yields no searchable types.
    expect(db.query).not.toHaveBeenCalled();

    db.query.mockClear();
    await search.search("t1", { q: "a", types: [] });
    // A-04: an EXPLICIT empty list is an empty allow-list, not "everything".
    // The caller filters the list by permission, so reading [] as "every
    // type" would hand a principal permitted nothing the entire tenant.
    expect(db.query).not.toHaveBeenCalled();

    db.query.mockClear();
    await search.search("t1", { q: "a" });
    // No list at all still means "every type".
    expect(db.query.mock.calls.length).toBeGreaterThan(1);
  });

  it("treats a missing rank on the left-hand row as 0 when sorting", async () => {
    db.query
      .mockResolvedValueOnce([{ id: "d1", name: "no rank" }])
      .mockResolvedValueOnce([{ id: "s1", itemName: "ranked", rank: 0.9 }]);

    const r = await search.search("t1", {
      q: "a",
      types: ["device", "stock"],
    });

    expect(r.total).toBe(2);
    // `Number(a.rank) || 0` demotes the unranked row.
    expect(r.results[0].id).toBe("s1");
  });

  it("treats a missing rank on the right-hand row as 0 when sorting", async () => {
    // Reversed order so the comparator hits `Number(b.rank) || 0`.
    db.query
      .mockResolvedValueOnce([{ id: "d1", name: "ranked", rank: 0.9 }])
      .mockResolvedValueOnce([{ id: "s1", itemName: "no rank" }]);

    const r = await search.search("t1", {
      q: "a",
      types: ["device", "stock"],
    });

    expect(r.total).toBe(2);
    expect(r.results[0].id).toBe("d1");
  });

  it("returns empty when called with no options object at all", async () => {
    const r = await search.search("t1");

    expect(r.total).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });
});
