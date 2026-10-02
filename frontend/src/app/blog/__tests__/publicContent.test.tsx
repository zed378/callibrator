/** @jest-environment jsdom */
/**
 * The public Blog & News pages (async Server Components) and their data
 * layer, lib/content.api.ts, against the backend's public content endpoints
 * (content.controller.ts):
 *  - GET /api/v1/content/posts/public?limit=100&type=&category= → rows in `data`
 *  - GET /api/v1/content/posts/public/:slug → `data: post`; 404 "Post not found"
 *  - GET /api/v1/content/categories/public → rows in `data`
 *
 * Real: the pages, content.api (its fetch parsing), the blog components.
 * Mocked: `fetch` (the backend), next/cache (cache directives are a no-op
 * outside Next), the `locale` cookie (next/headers), the language Server Action
 * and next/font. P10-13: the public header and footer render for real.
 *
 * Sanitisation (A-298): the article body is rendered with
 * dangerouslySetInnerHTML AFTER ArticleBody sanitizes it with the shared
 * policy (@callibrator/contracts/contentHtml, lib/safeHtml). Before A-298 it
 * trusted the backend's write-time pass alone, so a body stored before a
 * policy fix (a data: link) reached the page; the "stored before the fix"
 * test below failed then.
 *
 * Fail-before (axe heading-order): /news jumped from its h1 to the month
 * h3s; it now has a visually hidden h2, as /blog does.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("next/cache", () => ({ cacheLife: jest.fn(), cacheTag: jest.fn() }));
// P10-13: the pages render in the public shell (header, footer, language form)
// and read the `locale` cookie. English here, so the assertions read naturally;
// the Indonesian default is asserted separately below.
let mockLocale: string | undefined = "en";
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "locale" && mockLocale ? { value: mockLocale } : undefined) }),
}));
jest.mock("@/i18n/actions", () => ({ setLocale: jest.fn() }));
// next/font/local is a build-time transform; Jest only needs the class names.
jest.mock("@/app/fonts/public", () => ({
  publicDisplayFont: { variable: "font-pub-display" },
  publicBodyFont: { variable: "font-pub-sans" },
}));

import BlogPage from "../page";
import BlogDetailPage, { generateMetadata as blogMetadata } from "../[slug]/page";
import NewsPage from "../../news/page";
import NewsDetailPage, { generateMetadata as newsMetadata } from "../../news/[slug]/page";
import { formatDate, getPublishedPosts } from "@/lib/content.api";
import { renderServer, resolveServer } from "@/tests/support/serverTree";
import { API_BASE_URL } from "@/constants";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

// The async-Server-Component resolver lives in tests/support/serverTree (shared with the landing test).
const renderPage = renderServer;

const post = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  type: "BLOG",
  title: "Why calibration matters",
  slug: "why-calibration-matters",
  excerpt: "Keeping instruments honest.",
  coverImageUrl: null,
  contentHtml: "<h2>Traceability</h2><p>Every reading <a href=\"https://iso.org\" rel=\"noopener noreferrer\">traces</a> back.</p>",
  status: "PUBLISHED",
  publishedAt: "2026-09-01T00:00:00.000Z",
  authorName: "HDC Team",
  authorRole: "Quality",
  readingMinutes: 4,
  featured: false,
  categories: [{ id: "c1", name: "Compliance", slug: "compliance" }],
  createdAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

const envelope = (data: unknown) => ({ success: true, status: 200, message: "OK", data });

/** The backend: a map from path to response body (404 when absent). */
let routes: Record<string, unknown> = {};
const fetchMock = jest.fn(async (url: string) => {
  const path = url.replace(`${API_BASE_URL}/api/v1`, "");
  if (path in routes) {
    const body = routes[path];
    if (body instanceof Error) throw body;
    return { ok: true, json: async () => body };
  }
  return { ok: false, status: 404, json: async () => ({ success: false, status: 404, message: "Post not found" }) };
});

beforeEach(() => {
  jest.clearAllMocks();
  routes = {};
  mockLocale = "en";
  global.fetch = fetchMock as unknown as typeof fetch;
});

const params = (slug: string) => Promise.resolve({ slug });

describe("content.api", () => {
  it("asks the backend directly for published posts of a type and category", async () => {
    routes["/content/posts/public?limit=100&type=NEWS&category=iso"] = envelope([post({ type: "NEWS" })]);

    const rows = await getPublishedPosts("NEWS", "iso");

    expect(rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/api/v1/content/posts/public?limit=100&type=NEWS&category=iso`, {
      // A-310: the scheme a FORCE_HTTPS backend needs (http without NEXT_PUBLIC_SITE_URL).
      headers: { Accept: "application/json", "X-Forwarded-Proto": "http" },
    });
  });

  it("an unreachable backend or a non-array body yields an empty list, never a throw", async () => {
    routes["/content/posts/public?limit=100"] = new TypeError("fetch failed");
    await expect(getPublishedPosts()).resolves.toEqual([]);

    routes["/content/posts/public?limit=100"] = envelope({ rows: [] });
    await expect(getPublishedPosts()).resolves.toEqual([]);
  });

  it("formats dates deterministically, and nothing for no date", () => {
    expect(formatDate("2026-09-01T12:00:00.000Z")).toBe("September 1, 2026");
    expect(formatDate(null)).toBe("");
  });
});

describe("Blog index", () => {
  it("features the featured post and lists the rest, with category filters", async () => {
    routes["/content/posts/public?limit=100&type=BLOG"] = envelope([
      post({ id: "f", title: "Featured story", slug: "featured", featured: true, coverImageUrl: "/uploads/public/cms/f.png" }),
      post({ id: "b", title: "Second story", slug: "second", categories: [] }),
    ]);
    routes["/content/categories/public"] = envelope([{ id: "c1", name: "Compliance", slug: "compliance" }]);

    const { container } = await renderPage(BlogPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: /Featured story/ })).toHaveAttribute("href", "/blog/featured");
    expect(screen.getByRole("img", { name: "Featured story" })).toHaveAttribute("src", "/uploads/public/cms/f.png");
    expect(screen.getByRole("link", { name: /Second story/ })).toHaveAttribute("href", "/blog/second");
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/blog");
    expect(screen.getByRole("link", { name: "Compliance" })).toHaveAttribute("href", "/blog?category=compliance");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a category view shows no featured slot, and an empty one says so", async () => {
    routes["/content/posts/public?limit=100&type=BLOG&category=compliance"] = envelope([]);
    routes["/content/categories/public"] = envelope([]);

    await renderPage(BlogPage({ searchParams: Promise.resolve({ category: "compliance" }) }));

    expect(screen.getByText(/No articles here yet/)).toBeInTheDocument();
  });
});

describe("Blog article", () => {
  it("renders the stored article: title, meta, body as the backend stored it, and related posts", async () => {
    routes["/content/posts/public/why-calibration-matters"] = envelope(post({ coverImageUrl: "/uploads/public/cms/c.png" }));
    routes["/content/posts/public?limit=100&type=BLOG"] = envelope([
      post(),
      post({ id: "p2", title: "Related one", slug: "related-one" }),
    ]);

    const { container } = await renderPage(BlogDetailPage({ params: params("why-calibration-matters") }));

    expect(screen.getByRole("heading", { level: 1, name: "Why calibration matters" })).toBeInTheDocument();
    expect(screen.getByText("HDC Team")).toBeInTheDocument();
    expect(within(screen.getByRole("article")).getByText("4 min read")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Traceability" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "traces" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: /Related one/ })).toHaveAttribute("href", "/blog/related-one");
    // The article itself is not listed as related to itself.
    expect(screen.queryByRole("link", { name: /^Why calibration matters/ })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a body stored before the A-298 policy fix is sanitized at render: no data: link, handler or script", async () => {
    routes["/content/posts/public/why-calibration-matters"] = envelope(
      post({
        contentHtml:
          '<p>Read <a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">this</a>' +
          '<img src="x" onerror="window.__pwned=1"><script>window.__pwned=2</script></p>',
      }),
    );
    routes["/content/posts/public?limit=100&type=BLOG"] = envelope([post()]);

    const { container } = await renderPage(BlogDetailPage({ params: params("why-calibration-matters") }));

    const body = container.querySelector(".article-prose") as HTMLElement;
    expect(within(body).getByText("this")).not.toHaveAttribute("href");
    expect(body.querySelector("[onerror]")).toBeNull();
    expect(body.querySelector("script")).toBeNull();
  });

  it("an unknown slug (404) or a NEWS post under /blog is a Not Found", async () => {
    await expect(resolveServer(BlogDetailPage({ params: params("missing") }))).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });

    routes["/content/posts/public/a-news-item"] = envelope(post({ type: "NEWS", slug: "a-news-item" }));
    await expect(resolveServer(BlogDetailPage({ params: params("a-news-item") }))).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("metadata carries the title, canonical URL and cover image, or a generic title", async () => {
    routes["/content/posts/public/why-calibration-matters"] = envelope(post({ coverImageUrl: "/uploads/public/cms/c.png" }));

    const meta = await blogMetadata({ params: params("why-calibration-matters") });
    expect(meta).toMatchObject({
      title: "Why calibration matters — Device Calibrator",
      description: "Keeping instruments honest.",
      alternates: { canonical: "/blog/why-calibration-matters" },
      openGraph: { images: ["/uploads/public/cms/c.png"], publishedTime: "2026-09-01T00:00:00.000Z" },
    });
    await expect(blogMetadata({ params: params("missing") })).resolves.toEqual({ title: "Article — Device Calibrator" });
  });
});

describe("News", () => {
  it("groups the news by month, newest groups as the backend ordered them", async () => {
    routes["/content/posts/public?limit=100&type=NEWS"] = envelope([
      post({ id: "n1", type: "NEWS", title: "Sept item", slug: "sept", publishedAt: "2026-09-15T00:00:00.000Z" }),
      post({ id: "n2", type: "NEWS", title: "Sept item two", slug: "sept-2", publishedAt: "2026-09-02T00:00:00.000Z", excerpt: null }),
      post({ id: "n3", type: "NEWS", title: "Aug item", slug: "aug", publishedAt: "2026-08-10T00:00:00.000Z" }),
      post({ id: "n4", type: "NEWS", title: "Undated item", slug: "undated", publishedAt: null }),
    ]);

    const { container } = await renderPage(NewsPage());

    const months = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(months).toEqual(["September 2026", "August 2026", "Undated"]);
    const sept = screen.getByRole("heading", { level: 3, name: "September 2026" }).nextElementSibling as HTMLElement;
    expect(within(sept).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/news/sept", "/news/sept-2"]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no news: says so", async () => {
    routes["/content/posts/public?limit=100&type=NEWS"] = envelope([]);

    await renderPage(NewsPage());

    expect(screen.getByText(/No news yet/)).toBeInTheDocument();
  });

  it("a news article renders; a BLOG slug under /news is a Not Found", async () => {
    routes["/content/posts/public/lab"] = envelope(post({ type: "NEWS", slug: "lab", title: "Lab opens", categories: [] }));

    const { container } = await renderPage(NewsDetailPage({ params: params("lab") }));
    expect(screen.getByRole("heading", { level: 1, name: "Lab opens" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All news/ })).toHaveAttribute("href", "/news");
    expect(await axeViolations(container)).toEqual([]);

    routes["/content/posts/public/blog-post"] = envelope(post());
    await expect(resolveServer(NewsDetailPage({ params: params("blog-post") }))).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("news metadata, or a generic title", async () => {
    routes["/content/posts/public/lab"] = envelope(post({ type: "NEWS", slug: "lab", title: "Lab opens" }));

    await expect(newsMetadata({ params: params("lab") })).resolves.toMatchObject({
      title: "Lab opens — Device Calibrator News",
      alternates: { canonical: "/news/lab" },
    });
    await expect(newsMetadata({ params: params("nope") })).resolves.toEqual({ title: "News — Device Calibrator" });
  });
});

describe("ShareRow", () => {
  it("copies the page link and confirms, then resets", async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    routes["/content/posts/public/lab"] = envelope(post({ type: "NEWS", slug: "lab" }));
    await renderPage(NewsDetailPage({ params: params("lab") }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy link/ }));
    });
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(screen.getByRole("button", { name: /Link copied/ })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(screen.getByRole("button", { name: /Copy link/ })).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("uses the native share sheet when there is one, and falls back to copying", async () => {
    const share = jest.fn().mockRejectedValue(new Error("AbortError"));
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    routes["/content/posts/public/lab"] = envelope(post({ type: "NEWS", slug: "lab", title: "Lab opens" }));
    await renderPage(NewsDetailPage({ params: params("lab") }));

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "Lab opens", url: window.location.href }));
    expect(writeText).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });

  it("a refused clipboard changes nothing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) },
    });
    routes["/content/posts/public/lab"] = envelope(post({ type: "NEWS", slug: "lab" }));
    await renderPage(NewsDetailPage({ params: params("lab") }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy link/ }));
    });
    expect(screen.getByRole("button", { name: /Copy link/ })).toBeInTheDocument();
  });
});

describe("P10-13: blog and news on the public surface", () => {
  it("Indonesian by default: the chrome, the dates and the reading time follow the locale cookie", async () => {
    mockLocale = undefined;
    const { id } = await import("@/i18n/messages/id");
    routes["/content/posts/public?limit=100&type=BLOG"] = envelope([post()]);
    routes["/content/categories/public"] = envelope([{ id: "c1", name: "Compliance", slug: "compliance" }]);

    const { container } = await renderPage(BlogPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(id["content.blog.title"]);
    expect(screen.getByRole("link", { name: id["content.blog.all"] })).toHaveAttribute("href", "/blog");
    expect(screen.getByText("1 September 2026")).toBeInTheDocument();
    expect(screen.getByText("4 menit baca")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("one <main>, one <h1>, the public surface, and header anchors that lead back to the landing", async () => {
    routes["/content/posts/public/why-calibration-matters"] = envelope(post());
    routes["/content/posts/public?limit=100&type=BLOG"] = envelope([post()]);

    const { container } = await renderPage(BlogDetailPage({ params: params("why-calibration-matters") }));

    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelector("[data-surface='public']")).not.toBeNull();
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
    expect(within(nav).getByRole("link", { name: "Features" })).toHaveAttribute("href", "/#fitur");
    // The old gradient "Sign in" band is gone; the way forward is request access.
    expect(screen.getByRole("link", { name: /Request access for your hospital/ })).toHaveAttribute("href", "/request-access");
  });

  it("the active category is marked for assistive technology", async () => {
    routes["/content/posts/public?limit=100&type=BLOG&category=compliance"] = envelope([post()]);
    routes["/content/categories/public"] = envelope([{ id: "c1", name: "Compliance", slug: "compliance" }]);

    await renderPage(BlogPage({ searchParams: Promise.resolve({ category: "compliance" }) }));

    expect(screen.getByRole("link", { name: "Compliance" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
  });

  it("the blog and news sources load no animation library and not the old landing chrome", () => {
    const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
    const path = jest.requireActual<typeof import("node:path")>("node:path");
    const root = path.resolve(__dirname, "../../..");
    const files = [
      "app/blog/page.tsx",
      "app/blog/[slug]/page.tsx",
      "app/news/page.tsx",
      "app/news/[slug]/page.tsx",
      "components/public/ContentShell.tsx",
      ...fs.readdirSync(path.join(root, "components/blog")).map((f: string) => `components/blog/${f}`),
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect({ f, hit: /from\s+["'](?:gsap|lenis|motion|@gsap\/react)|LandingLayout|components\/motion/.test(src) }).toEqual({
        f,
        hit: false,
      });
    }
  });
});
