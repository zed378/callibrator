/**
 * A-298 — CMS bodies: no `data:` scheme, and sanitized again on every read.
 *
 * Fail-before: until A-298 `SANITIZE_OPTS` listed `data` in allowedSchemes, so
 * `createPost` stored `<a href="data:text/html,...">` as written, and every
 * read (`getPostById`, `getPublishedPostBySlug`) served the stored body
 * untouched — a body written before a policy fix stayed live forever. The
 * first test failed on the old policy (the href survived); the read tests
 * failed because the stored payload came back verbatim.
 *
 * Real: the service, sanitize-html and the shared policy
 * (@callibrator/contracts/contentHtml). Doubles: the models and the transaction.
 */
const mockPost = {
  findAndCountAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  unscoped: jest.fn(),
};
jest.mock("../../models", () => ({ Post: mockPost, Category: { unscoped: jest.fn() } }));
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(() => Promise.resolve({ commit: jest.fn(), rollback: jest.fn() })) },
}));
// P6-11: a post write commits with its audit row; the row is not what this suite is about.
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

import type ContentService from "../../services/content.service";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above, as every service test here does
const contentService = require("../../services/content.service") as typeof ContentService;

/** What the service handed Post.create. */
const createdBody = (): unknown => (mockPost.create.mock.calls[0] as [{ contentHtml: unknown }] | undefined)?.[0].contentHtml;
const echoCreate = (values: Record<string, unknown>): Promise<Record<string, unknown>> => Promise.resolve({ id: "p-1", ...values });

const DATA_LINK = '<p>hi <a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a></p>';
const STORED_ATTACK = `${DATA_LINK}<img src="x" onerror="alert(1)"><script>alert(2)</script>`;

const stored = (contentHtml: unknown): { id: string; toJSON: () => Record<string, unknown> } => ({
  id: "p-1",
  toJSON: () => ({ id: "p-1", title: "T", contentHtml }),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
});

describe("A-298 — write: the data: scheme is refused", () => {
  it("createPost stores a data: link without its href", async () => {
    mockPost.create.mockImplementation(echoCreate);
    mockPost.findByPk.mockResolvedValue(null);

    await contentService.createPost({ title: "T", contentHtml: DATA_LINK }, null);

    expect(createdBody()).toBe('<p>hi <a rel="noopener noreferrer">x</a></p>');
  });

  it("keeps https links (with rel added) and relative images", async () => {
    mockPost.create.mockImplementation(echoCreate);
    mockPost.findByPk.mockResolvedValue(null);

    await contentService.createPost(
      { title: "T", contentHtml: '<a href="https://e.x">a</a><img src="/uploads/public/a.png">' },
      null,
    );

    expect(createdBody()).toBe('<a href="https://e.x" rel="noopener noreferrer">a</a><img src="/uploads/public/a.png" />');
  });
});

describe("A-298 — read: a body stored under an older policy is served clean", () => {
  it("getPublishedPostBySlug re-sanitizes the stored body", async () => {
    mockPost.findOne.mockResolvedValue(stored(STORED_ATTACK));

    const result = (await contentService.getPublishedPostBySlug("s")) as { data: { contentHtml: string; title: string } };

    expect(result.data.contentHtml).toBe('<p>hi <a rel="noopener noreferrer">x</a></p><img src="x" />');
    expect(result.data.title).toBe("T");
  });

  it("getPostById (the editor's load) re-sanitizes the stored body", async () => {
    mockPost.findByPk.mockResolvedValue(stored(STORED_ATTACK));

    const result = (await contentService.getPostById("p-1")) as { data: { contentHtml: string } };

    expect(result.data.contentHtml).not.toMatch(/data:|onerror|<script/);
  });

  it("leaves a row without a string body as it was (list rows, a null body, no row)", async () => {
    mockPost.findByPk.mockResolvedValue(stored(null));
    const nullBody = (await contentService.getPostById("p-1")) as { data: unknown };
    expect(nullBody.data).toEqual({ id: "p-1", title: "T", contentHtml: null });

    mockPost.findAndCountAll.mockResolvedValue({ count: 1, rows: [{ id: "p-2", toJSON: () => ({ id: "p-2" }) }] });
    const list = (await contentService.listPublishedPosts({})) as unknown as { data: unknown };
    expect(list.data).toEqual([{ id: "p-2" }]);
  });
});
