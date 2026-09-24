/**
 * Migration 0056 — the public upload class (S-01, ADR-042 steps 3–4).
 *
 * Runs against a real temporary storage root and a fake QueryInterface. It
 * proves the file moves, the refusal on a conflicting destination, the CMS
 * copy-and-rewrite, idempotency, and `down`. The two UPDATE statements were
 * also run on PostgreSQL 16 (not 18) — see the agent report for 0056.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m0056-"));
jest.mock("../../utils/storagePath.util", () => (...parts) =>
  require("path").join(mockRoot, ...parts),
);

const migration = require("../../migrations/0056-uploads-public-class");

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");
const at = (...p) => path.join(mockRoot, ...p);
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
  fs.writeFileSync(at(rel), content);
};

const TX = { id: "tx" };
const fakeQueryInterface = ({ tables = ["certificates", "posts"], posts = [], certRows = 0 } = {}) => {
  const state = { queries: [] };
  return {
    state,
    showAllTables: jest.fn(async () => tables.map((t) => ({ tableName: t.toUpperCase() }))),
    sequelize: {
      transaction: jest.fn(async (cb) => cb(TX)),
      query: jest.fn(async (sql, options) => {
        expect(options.transaction).toBe(TX);
        state.queries.push({ sql, replacements: options.replacements });
        if (/^SELECT id/.test(sql)) {return [posts, {}];}
        if (/^UPDATE certificates/.test(sql)) {return [[], certRows ? { rowCount: certRows } : undefined];}
        return [[], { rowCount: 1 }];
      }),
    },
  };
};

beforeEach(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
  fs.mkdirSync(mockRoot, { recursive: true });
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => fs.rmSync(mockRoot, { recursive: true, force: true }));

describe("migration 0056 — uploads public class", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0056-uploads-public-class.js", require("../migrations/0056-uploads-public-class")]',
    );
  });

  it("moves avatars and logos into uploads/public/, skipping dotfiles and directories", async () => {
    write("uploads/profile/a.png", "A");
    write("uploads/profile/.keep", "");
    fs.mkdirSync(at("uploads/profile/sub"), { recursive: true });
    write("uploads/tenant/logo.svg", "<svg/>");
    const qi = fakeQueryInterface({ certRows: 2 });

    await migration.up({ context: qi });

    expect(fs.readFileSync(at("uploads/public/profile/a.png"), "utf8")).toBe("A");
    expect(fs.existsSync(at("uploads/profile/a.png"))).toBe(false);
    expect(fs.existsSync(at("uploads/profile/.keep"))).toBe(true);
    expect(fs.existsSync(at("uploads/public/tenant/logo.svg"))).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/moved 1 avatar\(s\), 1 logo\(s\) \(1 SVG.*2 certificate path\(s\) rewritten/),
    );
  });

  it("an identical file already at the destination is de-duplicated", async () => {
    write("uploads/profile/a.png", "SAME");
    write("uploads/public/profile/a.png", "SAME");
    await migration.up({ context: fakeQueryInterface() });
    expect(fs.existsSync(at("uploads/profile/a.png"))).toBe(false);
    expect(fs.readFileSync(at("uploads/public/profile/a.png"), "utf8")).toBe("SAME");
  });

  it("REFUSES when the destination holds different bytes, and touches neither file", async () => {
    write("uploads/tenant/l.png", "OLD");
    write("uploads/public/tenant/l.png", "NEW");
    const qi = fakeQueryInterface();
    await expect(migration.up({ context: qi })).rejects.toThrow(
      /0056 refused: uploads\/public\/tenant\/l\.png already exists with different content/,
    );
    expect(fs.readFileSync(at("uploads/tenant/l.png"), "utf8")).toBe("OLD");
    expect(fs.readFileSync(at("uploads/public/tenant/l.png"), "utf8")).toBe("NEW");
    expect(qi.sequelize.query).not.toHaveBeenCalled();
  });

  it("rewrites certificate paths from the old mount URL to a storage locator", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    expect(qi.state.queries[0].sql).toBe(
      "UPDATE certificates SET file_path = 'certificates/' || substring(file_path FROM '^/uploads/certificates/(.+)$') WHERE file_path LIKE '/uploads/certificates/%'",
    );
  });

  it("copies CMS images out of attachments and rewrites the posts that embed them", async () => {
    write("uploads/attachments/hero.png", "PNG");
    write("uploads/attachments/inline.webp", "WEBP");
    write("uploads/attachments/sheet.xlsx", "XLSX");
    const posts = [
      {
        id: "p-1",
        content_html:
          '<p><img src="/uploads/attachments/inline.webp"><a href="/uploads/attachments/sheet.xlsx">x</a>' +
          '<img src="/uploads/attachments/gone.png"></p>',
        cover_image_url: "/uploads/attachments/hero.png",
        author_avatar_url: null,
      },
      { id: "p-2", content_html: "<p>/uploads/attachments/sheet.xlsx</p>", cover_image_url: null, author_avatar_url: undefined },
    ];
    const qi = fakeQueryInterface({ posts });

    await migration.up({ context: qi });

    const updates = qi.state.queries.filter((q) => /^UPDATE posts/.test(q.sql));
    expect(updates).toHaveLength(1); // p-2 carries nothing it can move
    expect(updates[0].sql).toBe(
      "UPDATE posts SET content_html = :content_html, cover_image_url = :cover_image_url WHERE id = :id",
    );
    expect(updates[0].replacements).toEqual({
      id: "p-1",
      content_html:
        '<p><img src="/uploads/public/cms/inline.webp"><a href="/uploads/attachments/sheet.xlsx">x</a>' +
        '<img src="/uploads/attachments/gone.png"></p>',
      cover_image_url: "/uploads/public/cms/hero.png",
    });
    // Copied, not moved: the attachment may also be evidence.
    expect(fs.existsSync(at("uploads/public/cms/hero.png"))).toBe(true);
    expect(fs.existsSync(at("uploads/attachments/hero.png"))).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/1 post\(s\) rewritten, 3 reference\(s\) left/),
    );
  });

  it("a CMS file already copied is not copied again", () => {
    write("uploads/attachments/a.png", "NEW");
    write("uploads/public/cms/a.png", "FIRST");
    const { rewritten, skipped } = migration._carryCmsReferences("/uploads/attachments/a.png");
    expect(rewritten).toBe("/uploads/public/cms/a.png");
    expect(skipped).toBe(0);
    expect(fs.readFileSync(at("uploads/public/cms/a.png"), "utf8")).toBe("FIRST");
  });

  it("is a no-op on a second run, and on a database without the tables", async () => {
    write("uploads/profile/a.png", "A");
    await migration.up({ context: fakeQueryInterface() });
    const qi = fakeQueryInterface({ tables: [] });
    await migration.up({ context: qi });
    expect(qi.sequelize.query).not.toHaveBeenCalled();
    expect(fs.existsSync(at("uploads/public/profile/a.png"))).toBe(true);
    expect(migration._moveFolderContents("uploads/nothing-here", "uploads/public/x")).toEqual([]);
  });

  it("propagates a database failure (no blanket try/catch)", async () => {
    const qi = fakeQueryInterface();
    qi.sequelize.query.mockRejectedValueOnce(new Error("connection reset"));
    await expect(migration.up({ context: qi })).rejects.toThrow("connection reset");
  });

  it("down restores the certificate URL shape and moves the public class back", async () => {
    write("uploads/public/profile/a.png", "A");
    write("uploads/public/tenant/l.png", "L");
    const qi = fakeQueryInterface();
    await migration.down({ context: qi });
    expect(qi.state.queries.map((q) => q.sql)).toEqual([
      "UPDATE certificates SET file_path = '/uploads/' || file_path WHERE file_path LIKE 'certificates/%'",
    ]);
    expect(fs.existsSync(at("uploads/profile/a.png"))).toBe(true);
    expect(fs.existsSync(at("uploads/tenant/l.png"))).toBe(true);

    const bare = fakeQueryInterface({ tables: [] });
    await migration.down({ context: bare });
    expect(bare.sequelize.query).not.toHaveBeenCalled();
  });
});
