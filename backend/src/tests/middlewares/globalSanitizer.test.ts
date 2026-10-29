/**
 * Tests for globalSanitizer middleware
 * Tests recursive XSS sanitization of request body, query, and params,
 * as well as excluded fields and non-object inputs.
 */
import type { Request, Response } from "express";

// We need a spy on the internal xss module to verify calls and to avoid
// mutating global state.
jest.mock("xss", () => {
  const fn = jest.fn((str: string) => str.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return Object.assign(fn, { default: fn });
});

import type * as GlobalSanitizerModule from "../../middlewares/globalSanitizer.middleware";

const { globalSanitizer } =
  jest.requireActual<typeof GlobalSanitizerModule>("../../middlewares/globalSanitizer.middleware");

interface MockReq {
  body?: unknown;
  query?: Record<string, unknown> | undefined;
  params?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createMockReq } = require("../utils/test.utils") as {
  createMockReq: () => MockReq;
};

describe("globalSanitizer middleware", () => {
  let req: MockReq;
  let res: Record<string, unknown>;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    req = createMockReq();
    res = {};
    next = jest.fn();
  });

  it("should call next() after sanitizing body, query, and params", () => {
    req.body = { name: "<script>alert(1)</script>" };
    req.query = { q: "<img onerror=xss()>" };
    req.params = { id: "<b>123</b>" };

    globalSanitizer(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it("should sanitize string values in req.body", () => {
    req.body = { title: "<h1>Hello</h1>", safe: "normal text" };
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);

    // xss mock replaces < and >
    const body = req.body as { title: string; safe: string };
    expect(body.title).toBe("&lt;h1&gt;Hello&lt;/h1&gt;");
    expect(body.safe).toBe("normal text");
    next();
  });

  it("should not sanitize excluded fields (avatar_url, avatar, etc.)", () => {
    req.body = {
      avatar_url: "<script>steal()</script>",
      avatar: "<img src=x>",
      signature: "<b>bold</b>",
      file_content: "<evil>",
      content_base64: "abc<script>",
    };
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);

    // Excluded fields should be returned as-is (no xss() call on them)
    const body = req.body as Record<string, string>;
    expect(body["avatar_url"]).toBe("<script>steal()</script>");
    expect(body["avatar"]).toBe("<img src=x>");
    expect(body["signature"]).toBe("<b>bold</b>");
    expect(body["file_content"]).toBe("<evil>");
    expect(body["content_base64"]).toBe("abc<script>");
    next();
  });

  it("should recursively sanitize nested objects", () => {
    req.body = {
      user: {
        name: "<script>x</script>",
        profile: {
          bio: "<img onerror=xss>",
        },
      },
    };
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);

    const body = req.body as { user: { name: string; profile: { bio: string } } };
    expect(body.user.name).toBe("&lt;script&gt;x&lt;/script&gt;");
    expect(body.user.profile.bio).toBe("&lt;img onerror=xss&gt;");
    next();
  });

  it("should sanitize array values inside req.body", () => {
    req.body = { tags: ["<a>link</a>", "<b>bold", "normal"] };
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);

    const body = req.body as { tags: string[] };
    expect(body.tags).toEqual(["&lt;a&gt;link&lt;/a&gt;", "&lt;b&gt;bold", "normal"]);
    next();
  });

  it("should mutate req.query in place (safe for Express 5 getter-only query)", () => {
    req.query = { filter: "<script>", page: "1" };
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);

    expect(req.query["filter"]).toBe("&lt;script&gt;");
    expect(req.query["page"]).toBe("1");
    next();
  });

  it("should sanitize req.params", () => {
    req.params = { id: "<script>alert(1)</script>" };
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);

    expect(req.params["id"]).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    next();
  });

  it("should skip undefined/null body gracefully", () => {
    req.body = null;
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it("should handle empty body object", () => {
    req.body = {};
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it("should skip undefined/null query gracefully", () => {
    req.query = undefined;
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it("should skip undefined/null params gracefully", () => {
    req.params = undefined;
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it("should preserve non-string primitives in body", () => {
    req.body = { count: 42, active: true, nothing: null };
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);

    const body = req.body as { count: number; active: boolean; nothing: unknown };
    expect(body.count).toBe(42);
    expect(body.active).toBe(true);
    expect(body.nothing).toBeNull();
    next();
  });

  it("should not sanitize objects that are values of excluded fields", () => {
    req.body = {
      avatar: { url: "<script>", width: 100 },
    };
    globalSanitizer(req as unknown as Request, res as unknown as Response, next);

    // avatar is excluded, so the whole value passes through un-sanitized
    const body = req.body as { avatar: { url: string; width: number } };
    expect(body.avatar.url).toBe("<script>");
    next();
  });

  it("should drop inherited properties and only sanitize own ones", () => {
    // A prototype-polluted payload: `inherited` is enumerable and therefore
    // visible to for..in, but the hasOwnProperty guard must exclude it from
    // the sanitized result.
    const proto = { inherited: "<img src=x onerror=alert(1)>" };
    const nested = Object.create(proto) as { inherited?: string; own?: string };
    nested.own = "<script>alert(1)</script>";
    req.body = { nested };

    globalSanitizer(req as unknown as Request, res as unknown as Response, next);

    const body = req.body as { nested: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(body.nested, "inherited")).toBe(
      false,
    );
    expect(body.nested["own"]).not.toContain("<script>");
    expect(next).toHaveBeenCalled();
  });
});
