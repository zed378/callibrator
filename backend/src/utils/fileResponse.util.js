// src/utils/fileResponse.util.js
//
// ADR-042 step 5 (S-01). The one place that decides how a stored file is put
// on the wire by a GATED route — the signed storage object, an attachment
// download, the signed certificate document.
//
// The static mount used to be the only path that could back an <img> or the
// verification page's <iframe>: it had ETag/Last-Modified, Range and inline
// rendering, and the gated routes had a hardcoded `Content-Disposition:
// attachment` and nothing else. Moving evidence off the static mount (step 4)
// needed the gated routes to do what the mount did — without re-opening what
// the mount got wrong:
//
//   - Content-Disposition is driven by the Content-Type, not by the caller:
//     `inline` ONLY for types a browser renders passively (raster images, PDF);
//     everything else is `attachment`.
//   - nosniff always, so the browser never promotes a type.
//   - A CSP on the response itself: `default-src 'none'; sandbox` for images
//     and downloads (nothing an opened file contains can run), and — for PDF,
//     whose built-in viewers refuse to render inside a sandboxed document — a
//     CSP that still forbids everything but being framed where allowed.
//   - `Cache-Control: private, no-cache, no-transform` — private (never a
//     shared cache), revalidated with the ETag (a 304 is cheap), and
//     no-transform so the global compression() middleware leaves already-
//     compressed PDFs/JPEGs and byte ranges alone.

const path = require("path");
const { AppError } = require("./appError.util");

/** Types a browser renders passively and which may therefore be `inline`. */
const SAFE_INLINE_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

/** Extension -> type, for drivers that store no Content-Type (local/NFS). */
const TYPES_BY_EXTENSION = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
});

const OCTET_STREAM = "application/octet-stream";

/**
 * The Content-Type to serve a stored object as: the recorded one when there
 * is one, otherwise the extension's (only for the types above), otherwise
 * opaque bytes.
 *
 * @param {string|null|undefined} recorded
 * @param {string} name - file name or key
 * @returns {string}
 */
const contentTypeFor = (recorded, name) => {
  if (recorded) {return String(recorded);}
  const ext = path.extname(String(name || "")).toLowerCase();
  return TYPES_BY_EXTENSION[ext] || OCTET_STREAM;
};

/** Base MIME type without parameters, lowercased. */
const baseType = (contentType) => String(contentType).split(";")[0].trim().toLowerCase();

/** Whether a Content-Type may be rendered inline. */
const isInlineSafe = (contentType) => SAFE_INLINE_TYPES.includes(baseType(contentType));

/**
 * A Content-Disposition header value. The ASCII `filename` is a sanitised
 * fallback; `filename*` carries the real name (RFC 6266 / 5987).
 *
 * @param {"inline"|"attachment"} type
 * @param {string} [fileName]
 * @returns {string}
 */
const dispositionHeader = (type, fileName) => {
  if (!fileName) {return type;}
  const name = String(fileName);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

/**
 * Set the hardened headers for a stored file.
 *
 * @param {import("express").Response} res
 * @param {object} opts
 * @param {string} opts.contentType
 * @param {string} [opts.fileName] - the saved-as name
 * @param {string} [opts.frameAncestors] - CSP frame-ancestors source list;
 *   default `'none'`. Anything else also drops X-Frame-Options (helmet's
 *   SAMEORIGIN), which CSP frame-ancestors supersedes.
 */
const applyFileHeaders = (res, { contentType, fileName, frameAncestors = "'none'" }) => {
  const inline = isInlineSafe(contentType);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", dispositionHeader(inline ? "inline" : "attachment", fileName));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache, no-transform");
  const isPdf = baseType(contentType) === "application/pdf";
  res.setHeader(
    "Content-Security-Policy",
    isPdf
      ? `default-src 'none'; frame-ancestors ${frameAncestors}`
      : `default-src 'none'; sandbox; frame-ancestors ${frameAncestors}`,
  );
  if (frameAncestors !== "'none'") {
    res.removeHeader("X-Frame-Options");
  }
};

/**
 * Stream a file on local disk through res.sendFile, which answers
 * If-None-Match / If-Modified-Since with 304 and a single `Range` with 206
 * (ETag and Last-Modified from the file's stat). Headers from
 * applyFileHeaders are set first; sendFile keeps the Content-Type it finds.
 *
 * @param {import("express").Response} res
 * @param {string} absPath
 * @param {object} opts - as applyFileHeaders
 * @returns {Promise<void>} resolves when the response is sent; rejects with a
 *   410 AppError when the file vanished before anything was sent
 */
const sendStoredFile = (res, absPath, opts) =>
  new Promise((resolve, reject) => {
    applyFileHeaders(res, opts);
    res.sendFile(
      absPath,
      { dotfiles: "allow", acceptRanges: true, lastModified: true, etag: true, cacheControl: false },
      (err) => {
        if (!err) {return resolve();}
        if (res.headersSent) {
          // Mid-stream failure (client aborted, file vanished): nothing more
          // can be said on this response.
          return resolve();
        }
        if (err.code === "ENOENT" || err.status === 404) {
          return reject(new AppError(410, "Stored file is no longer available"));
        }
        return reject(err);
      },
    );
  });

module.exports = {
  SAFE_INLINE_TYPES,
  contentTypeFor,
  isInlineSafe,
  dispositionHeader,
  applyFileHeaders,
  sendStoredFile,
};
