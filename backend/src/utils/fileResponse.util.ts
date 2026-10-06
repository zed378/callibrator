// src/utils/fileResponse.util.ts
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
//
// P9-09 (ADR-087): converted from fileResponse.util.js with no behaviour change.

import { extname } from "path";
import type { Request, Response } from "express";
import { AppError } from "./appError.util";

/** Types a browser renders passively and which may therefore be `inline`. */
const SAFE_INLINE_TYPES: readonly string[] = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

/** Extension -> type, for drivers that store no Content-Type (local/NFS). */
const TYPES_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
});

const OCTET_STREAM = "application/octet-stream";

/** What `res.sendFile` may report besides an Error's own fields. */
interface SendFileError extends Error {
  code?: unknown;
  status?: unknown;
}

/** How a stored file is sent: its type, its saved-as name, who may frame it. */
export interface FileHeaderOptions {
  contentType: string;
  /** the saved-as name */
  fileName?: string | undefined;
  /**
   * CSP frame-ancestors source list; default `'none'`. Anything else also
   * drops X-Frame-Options (helmet's SAMEORIGIN), which CSP frame-ancestors
   * supersedes.
   */
  frameAncestors?: string | undefined;
}

/**
 * The Content-Type to serve a stored object as: the recorded one when there
 * is one, otherwise the extension's (only for the types above), otherwise
 * opaque bytes.
 *
 * @param recorded
 * @param name - file name or key
 */
const contentTypeFor = (recorded: string | null | undefined, name: string | null | undefined): string => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as-built (ADR-038 rule 3): JavaScript callers may pass a non-string
  if (recorded) {return String(recorded);}
  // `||`: an empty name and a missing one are the same, and an unknown
  // extension falls through to opaque bytes — as before.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-type-conversion -- as-built (ADR-038 rule 3)
  const ext = extname(String(name || "")).toLowerCase();
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as-built (ADR-038 rule 3)
  return TYPES_BY_EXTENSION[ext] || OCTET_STREAM;
};

/** Base MIME type without parameters, lowercased. */
const baseType = (contentType: string): string =>
  // `split(";", 1).join("")` is the old `split(";")[0]`: the text before the
  // first ";" (the whole string when there is none), without an index that
  // the compiler would have to treat as possibly undefined.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as-built (ADR-038 rule 3): JavaScript callers may pass a non-string
  String(contentType).split(";", 1).join("").trim().toLowerCase();

/** Whether a Content-Type may be rendered inline. */
const isInlineSafe = (contentType: string): boolean => SAFE_INLINE_TYPES.includes(baseType(contentType));

/**
 * A Content-Disposition header value. The ASCII `filename` is a sanitised
 * fallback; `filename*` carries the real name (RFC 6266 / 5987).
 */
const dispositionHeader = (type: "inline" | "attachment", fileName?: string): string => {
  if (!fileName) {return type;}
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as-built (ADR-038 rule 3): JavaScript callers may pass a non-string
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
 */
const applyFileHeaders = (res: Response, { contentType, fileName, frameAncestors = "'none'" }: FileHeaderOptions): void => {
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
 * @param opts - as applyFileHeaders
 * @returns resolves when the response is sent; rejects with a 410 AppError
 *   when the file vanished before anything was sent
 */
const sendStoredFile = (res: Response, absPath: string, opts: FileHeaderOptions): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    applyFileHeaders(res, opts);
    res.sendFile(
      absPath,
      { dotfiles: "allow", acceptRanges: true, lastModified: true, etag: true, cacheControl: false },
      (err: SendFileError | undefined) => {
        // `resolve(); return;` is the old `return resolve();` — the callback's
        // return value was always undefined and is never read.
        if (!err) {resolve(); return;}
        if (res.headersSent) {
          // Mid-stream failure (client aborted, file vanished): nothing more
          // can be said on this response.
          resolve();
          return;
        }
        if (err.code === "ENOENT" || err.status === 404) {
          reject(new AppError(410, "Stored file is no longer available"));
          return;
        }
        reject(err);
      },
    );
  });

// ------------------------------------------------------------------
// A STORAGE OBJECT (P8-01, ADR-086 Amendment 1)
// ------------------------------------------------------------------
//
// sendStoredFile above needs a path on THIS host's disk. An object in
// pluggable storage (the local or NFS driver's root, or an S3 bucket) has no
// such path, so it is sent from the driver's `stat` and `get(range)` instead.
// This is the body of storage.controller#getObject (ADR-042 step 5), moved
// here unchanged so every gated route that serves an object answers the same
// way: 304 from the validators, one `bytes=` Range as 206, an unsatisfiable
// one as 416, If-Range honoured, HEAD from the metadata, and the object opened
// only for the bytes asked for.

/** What a driver's `stat` answers for an object (read as the drivers return it). */
export interface StorageObjectMeta {
  key?: unknown;
  contentType?: string | null;
  size?: unknown;
  etag?: unknown;
  modifiedAt?: string | number | Date | null;
}

/** A stored object: its metadata, and how to open (a range of) it. */
export interface StorageObject {
  meta: StorageObjectMeta;
  open: (range?: { start: number; end: number } | null) => Promise<unknown>;
}

/** The object stream a driver's `get` answers. */
interface ObjectStream {
  on(event: "error", listener: () => void): unknown;
  pipe(destination: Response): unknown;
}

/**
 * A validator for the object: the driver's own ETag when it has one (S3),
 * otherwise a weak tag from size + mtime (local/NFS) — the same inputs
 * express.static and res.sendFile use. Null when there is nothing stable to
 * derive it from.
 */
const entityTag = (meta: StorageObjectMeta): string | null => {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: the driver's tag, stringified
  if (meta.etag) {return String(meta.etag);}
  if (typeof meta.size === "number" && meta.modifiedAt) {
    const mtime = new Date(meta.modifiedAt).getTime();
    return `W/"${meta.size.toString(16)}-${mtime.toString(16)}"`;
  }
  return null;
};

/**
 * Send a storage object with the hardened headers (applyFileHeaders, or the
 * caller's own `applyHeaders` for the public image class) and the
 * conditional/range semantics above.
 */
const sendStorageObject = async (
  req: Request,
  res: Response,
  object: StorageObject,
  opts: FileHeaderOptions & { applyHeaders?: ((res: Response) => void) | undefined },
): Promise<void> => {
  const { meta, open } = object;
  if (opts.applyHeaders) {
    opts.applyHeaders(res);
  } else {
    applyFileHeaders(res, opts);
  }

  const size = typeof meta.size === "number" ? meta.size : null;
  const etag = entityTag(meta);
  if (etag) {res.setHeader("ETag", etag);}
  const lastModified = meta.modifiedAt ? new Date(meta.modifiedAt).toUTCString() : null;
  if (lastModified) {res.setHeader("Last-Modified", lastModified);}

  if ((etag ?? lastModified) && req.fresh) {
    res.status(304).end();
    return;
  }

  let range: { start: number; end: number } | null = null;
  if (size !== null) {
    res.setHeader("Accept-Ranges", "bytes");
    const ifRange = req.headers["if-range"];
    const rangeApplies = !ifRange || ifRange === etag || ifRange === lastModified;
    const parsed = rangeApplies ? req.range(size, { combine: true }) : undefined;
    if (parsed === -1) {
      res.setHeader("Content-Range", `bytes */${String(size)}`);
      // P8-01: a caller may have announced the object's length already (the
      // backup and export downloads do, as they did for res.download); this
      // answer has no body, and a stale Content-Length would leave the client
      // waiting for bytes that never come.
      res.removeHeader("Content-Length");
      res.status(416).end();
      return;
    }
    if (Array.isArray(parsed) && (parsed as { type?: unknown }).type === "bytes" && parsed.length === 1) {
      const [only] = parsed as unknown as [{ start: number; end: number }];
      range = { start: only.start, end: only.end };
    }
  }

  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`);
    res.setHeader("Content-Length", range.end - range.start + 1);
  } else if (size !== null) {
    res.setHeader("Content-Length", size);
  }

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const stream = (await open(range)) as ObjectStream;
  stream.on("error", () => {
    // The object vanished mid-stream (concurrent delete). Headers may already
    // be sent, so we can only abort the connection.
    if (!res.headersSent) {res.status(410).end();}
    else {res.destroy();}
  });
  stream.pipe(res);
};

export {
  SAFE_INLINE_TYPES,
  contentTypeFor,
  isInlineSafe,
  dispositionHeader,
  applyFileHeaders,
  sendStoredFile,
  entityTag,
  sendStorageObject,
};
