/**
 * A-296 guard — no route parses a multipart body without sanitizing it.
 *
 * globalSanitizer (index.js) runs before the routers, so it never sees a
 * multipart body: multer parses that inside the route. The rule that keeps a
 * multipart body escaped like its JSON twin is therefore structural:
 *
 *  1. multer (and every other multipart parser) is used ONLY in
 *     utils/upload.util.ts — a route takes upload(), uploadMulti() or
 *     uploadToMemory() from there, never multer itself;
 *  2. in that module every multer parse site is followed by
 *     sanitizeParsedBody(req) — the parse-site count and the call count match;
 *  3. each of the three helpers, driven by a REAL multipart request through
 *     REAL multer, hands the next handler an escaped body identical to what
 *     globalSanitizer makes of the same fields as JSON.
 *
 * A new `require("multer")` in a route, or a new `.single(` / `.array(` /
 * `.fields(` / `.any(` / `.none(` in upload.util without the sanitizer, fails
 * here.
 */
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { Request, RequestHandler } from "express";
import xss from "xss";
import type * as UploadUtil from "../../utils/upload.util";
import type * as Sanitizer from "../../middlewares/globalSanitizer.middleware";

const { upload, uploadMulti, uploadToMemory } = jest.requireActual<typeof UploadUtil>("../../utils/upload.util");
const { globalSanitizer, sanitizeParsedBody } = jest.requireActual<typeof Sanitizer>(
  "../../middlewares/globalSanitizer.middleware",
);

const BACKEND = path.resolve(__dirname, "../../..");
const SRC = path.join(BACKEND, "src");
const UPLOAD_UTIL = path.join(SRC, "utils", "upload.util.ts");

/** Packages that parse a multipart body. */
const MULTIPART_PARSERS = ["multer", "busboy", "@fastify/busboy", "formidable", "multiparty", "connect-multiparty", "express-fileupload"];

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return full === path.join(SRC, "tests") ? [] : sourceFiles(full);
    }
    return /\.(c|m)?(j|t)s$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });

const importsParser = (text: string): string | null => {
  for (const pkg of MULTIPART_PARSERS) {
    const quoted = `["']${pkg.replace("/", "\\/")}["']`;
    if (new RegExp(`require\\(\\s*${quoted}\\s*\\)|from\\s+${quoted}|import\\(\\s*${quoted}\\s*\\)`).test(text)) {
      return pkg;
    }
  }
  return null;
};

describe("A-296 guard: multipart parsing lives in utils/upload.util only", () => {
  it("no source file but upload.util.ts (nor index.js) loads a multipart parser", () => {
    const files = [...sourceFiles(SRC), path.join(BACKEND, "index.js")];
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((f) => f !== UPLOAD_UTIL)
      .map((f) => ({ file: path.relative(BACKEND, f), pkg: importsParser(fs.readFileSync(f, "utf8")) }))
      .filter((o) => o.pkg !== null);
    expect(offenders).toEqual([]);
    // The rule is not vacuous: upload.util itself is found by the same test.
    expect(importsParser(fs.readFileSync(UPLOAD_UTIL, "utf8"))).toBe("multer");
  });

  it("every multer parse site in upload.util.ts is followed by sanitizeParsedBody(req)", () => {
    const text = fs.readFileSync(UPLOAD_UTIL, "utf8");
    const parseSites = text.match(/\buploader\.(single|array|fields|any|none)\(/g) ?? [];
    const sanitizes = text.match(/\bsanitizeParsedBody\(req\)/g) ?? [];
    expect(parseSites.length).toBe(3);
    expect(sanitizes.length).toBe(parseSites.length);
    // Each parse site's callback reaches the sanitizer before its next().
    for (const block of text.split(/\buploader\.(?:single|array|fields|any|none)\(/).slice(1)) {
      const success = block.slice(0, block.indexOf("next();"));
      expect(success).toContain("sanitizeParsedBody(req)");
    }
  });
});

// ------------------------------------------------------------------
// 3. The three helpers, through real multer
// ------------------------------------------------------------------

const PAYLOAD = "<script>alert(1)</script>Ward <img src=x onerror=alert(2)>";

interface Seen {
  body: Record<string, unknown>;
  plainPrototype: boolean;
  file: { originalname?: string; size?: number } | null;
}

let server: Server;
let base = "";

const record: RequestHandler = (req, res) => {
  const body = req.body as Record<string, unknown>;
  const seen: Seen = {
    body,
    plainPrototype: Object.getPrototypeOf(body) === Object.prototype,
    file: req.file ? { originalname: req.file.originalname, size: req.file.size } : null,
  };
  res.json(seen);
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(globalSanitizer);
  app.post("/json", record);
  app.post("/upload", upload({ folder: "uploads/a296-guard" }), record);
  app.post("/multi", uploadMulti({ folder: "uploads/a296-guard" }), record);
  app.post("/memory", uploadToMemory({ maxFileSize: 1024 }), record);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const fields = { name: PAYLOAD, note: "plain", nested: "<b onclick=x()>b</b>" };

const postJson = async (): Promise<Seen> => {
  const res = await fetch(`${base}/json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
  return (await res.json()) as Seen;
};

const postForm = async (route: string, withFile = false): Promise<{ status: number; seen: Seen }> => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, v);
  }
  if (withFile) {
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "a.txt");
  }
  const res = await fetch(`${base}${route}`, { method: "POST", body: form });
  return { status: res.status, seen: (await res.json()) as Seen };
};

describe("A-296: each upload helper sanitizes the multipart fields exactly like the JSON path", () => {
  it.each(["/upload", "/multi", "/memory"])("%s", async (route) => {
    const json = await postJson();
    const { status, seen } = await postForm(route);
    expect(status).toBe(200);
    expect(seen.body).toEqual(json.body);
    expect(seen.body["name"]).toBe(xss(PAYLOAD));
    expect(String(seen.body["name"])).not.toContain("<script");
    // multer's null-prototype body is replaced by a plain object, as a JSON body is.
    expect(seen.plainPrototype).toBe(true);
  });

  it("uploadToMemory still hands the file over in memory", async () => {
    const { status, seen } = await postForm("/memory", true);
    expect(status).toBe(200);
    expect(seen.file).toEqual({ originalname: "a.txt", size: 5 });
    expect(seen.body["name"]).toBe(xss(PAYLOAD));
  });

  it("uploadToMemory hands a multer error on untouched (as ai.route's own multer did)", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.alloc(2048)]), "big.bin");
    const res = await new Promise<{ code: unknown }>((resolve, reject) => {
      const app = express();
      app.post("/memory", uploadToMemory({ maxFileSize: 1024 }), record);
      // Express recognises an error handler by its four parameters.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the fourth parameter makes it an error handler
      app.use((err: unknown, _req: Request, r: express.Response, _next: express.NextFunction) => {
        r.status(413).json({ code: (err as { code?: unknown }).code });
      });
      const s = app.listen(0, "127.0.0.1", () => {
        const port = (s.address() as AddressInfo).port;
        fetch(`http://127.0.0.1:${String(port)}/memory`, { method: "POST", body: form })
          .then((r) => r.json() as Promise<{ code: unknown }>)
          .then((b) => {
            s.close();
            resolve(b);
          })
          .catch((e: unknown) => {
            s.close();
            reject(e instanceof Error ? e : new Error(String(e)));
          });
      });
    });
    expect(res.code).toBe("LIMIT_FILE_SIZE");
  });
});

describe("sanitizeParsedBody", () => {
  const run = (body: unknown): unknown => {
    const holder: { body: unknown } = { body };
    sanitizeParsedBody(holder as unknown as Request);
    return holder.body;
  };

  it("escapes an object body into a fresh plain object", () => {
    const body = Object.assign(Object.create(null) as Record<string, unknown>, { a: "<script>x</script>" });
    const out = run(body);
    expect(out).not.toBe(body);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(out).toEqual({ a: xss("<script>x</script>") });
  });

  it("leaves an absent, empty-string or non-object body as it is", () => {
    expect(run(undefined)).toBeUndefined();
    expect(run("")).toBe("");
    expect(run("<b>raw</b>")).toBe("<b>raw</b>");
  });
});
