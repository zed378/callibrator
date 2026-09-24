/**
 * ADR-042 step 5 (S-01) — fileResponse.util: how a gated route puts a stored
 * file on the wire. The HTTP behaviour (304/206 over a real socket) is proven
 * in routes/fileServing.s01.test.js; this file pins the decisions.
 */
const {
  SAFE_INLINE_TYPES,
  contentTypeFor,
  isInlineSafe,
  dispositionHeader,
  applyFileHeaders,
  sendStoredFile,
} = require("../../utils/fileResponse.util");

const makeRes = () => {
  const headers = {};
  return {
    headers,
    headersSent: false,
    setHeader: jest.fn((k, v) => {
      headers[k.toLowerCase()] = v;
    }),
    removeHeader: jest.fn((k) => {
      delete headers[k.toLowerCase()];
    }),
    sendFile: jest.fn(),
  };
};

describe("fileResponse.util — decisions", () => {
  it("ADR-042: only raster images and PDF are inline-safe; SVG and HTML never are", () => {
    expect(SAFE_INLINE_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
    ]);
    expect(isInlineSafe("image/svg+xml")).toBe(false);
    expect(isInlineSafe("text/html")).toBe(false);
    expect(isInlineSafe("text/plain")).toBe(false);
    expect(isInlineSafe("Application/PDF; charset=binary")).toBe(true);
  });

  it("takes the recorded type, else an allowlisted extension's, else opaque bytes", () => {
    expect(contentTypeFor("text/csv", "a.pdf")).toBe("text/csv");
    expect(contentTypeFor(null, "a.JPG")).toBe("image/jpeg");
    expect(contentTypeFor(null, "a.svg")).toBe("application/octet-stream");
    expect(contentTypeFor(undefined, undefined)).toBe("application/octet-stream");
  });

  it("builds an RFC 6266 disposition with an ASCII fallback and a UTF-8 name", () => {
    expect(dispositionHeader("attachment")).toBe("attachment");
    expect(dispositionHeader("inline", 'Zertifikat "Ä" (1)*.pdf')).toBe(
      "inline; filename=\"Zertifikat ___ (1)*.pdf\"; filename*=UTF-8''Zertifikat%20%22%C3%84%22%20%281%29%2A.pdf",
    );
  });

  it("applies the hardened headers: a sandbox for non-PDF, frame-ancestors 'none' by default", () => {
    const res = makeRes();
    applyFileHeaders(res, { contentType: "text/plain", fileName: "n.txt" });
    expect(res.headers).toMatchObject({
      "content-type": "text/plain",
      "content-disposition": expect.stringMatching(/^attachment;/),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-cache, no-transform",
      "content-security-policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
    });
    expect(res.removeHeader).not.toHaveBeenCalled();
  });

  it("a PDF is not sandboxed (built-in viewers refuse to render there); a wider frame-ancestors drops X-Frame-Options", () => {
    const res = makeRes();
    res.headers["x-frame-options"] = "SAMEORIGIN";
    applyFileHeaders(res, { contentType: "application/pdf", frameAncestors: "'self'" });
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'self'");
    expect(res.headers["content-disposition"]).toBe("inline");
    expect(res.headers["x-frame-options"]).toBeUndefined();
  });
});

describe("fileResponse.util — sendStoredFile", () => {
  it("passes conditional/range options to sendFile and resolves when sent", async () => {
    const res = makeRes();
    res.sendFile.mockImplementation((p, opts, cb) => cb());
    await expect(sendStoredFile(res, "/abs/f.png", { contentType: "image/png" })).resolves.toBeUndefined();
    expect(res.sendFile).toHaveBeenCalledWith(
      "/abs/f.png",
      { dotfiles: "allow", acceptRanges: true, lastModified: true, etag: true, cacheControl: false },
      expect.any(Function),
    );
  });

  it("maps a vanished file to 410 before anything is sent", async () => {
    const res = makeRes();
    res.sendFile.mockImplementation((p, opts, cb) => cb(Object.assign(new Error("x"), { status: 404 })));
    await expect(sendStoredFile(res, "/abs/f", { contentType: "image/png" })).rejects.toMatchObject({
      status: 410,
    });
  });

  it("forwards any other failure before anything is sent", async () => {
    const res = makeRes();
    res.sendFile.mockImplementation((p, opts, cb) => cb(Object.assign(new Error("EACCES"), { code: "EACCES" })));
    await expect(sendStoredFile(res, "/abs/f", { contentType: "image/png" })).rejects.toThrow("EACCES");
  });

  it("resolves quietly on a failure after the headers went out (client aborted)", async () => {
    const res = makeRes();
    res.sendFile.mockImplementation((p, opts, cb) => {
      res.headersSent = true;
      cb(new Error("ECONNRESET"));
    });
    await expect(sendStoredFile(res, "/abs/f", { contentType: "image/png" })).resolves.toBeUndefined();
  });
});
