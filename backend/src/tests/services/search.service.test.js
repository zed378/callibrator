jest.mock("../../config", () => ({ db: { query: jest.fn() } }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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

  it("degrades to no results for a type when BOTH FTS and ILIKE fail", async () => {
    const { logger } = require("../../middlewares/activityLog.middleware");
    db.query
      .mockRejectedValueOnce(new Error("column search_vector does not exist"))
      .mockRejectedValueOnce(new Error("relation does not exist"));

    const r = await search.search("t1", { q: "widget", types: ["device"] });

    // A dead type must not fail the whole search — it yields [] and logs.
    expect(r.total).toBe(0);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
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

  it("ignores unknown types and searches all types when the filter is empty", async () => {
    db.query.mockResolvedValue([]);

    await search.search("t1", { q: "a", types: ["nope"] });
    // An all-unknown filter yields no searchable types.
    expect(db.query).not.toHaveBeenCalled();

    db.query.mockClear();
    await search.search("t1", { q: "a", types: [] });
    // An empty filter means "every type".
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
