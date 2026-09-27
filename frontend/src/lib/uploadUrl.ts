// src/lib/uploadUrl.ts

/**
 * Normalise a backend upload URL for use with next/image.
 *
 * The backend builds ABSOLUTE upload URLs from its own HOST_URL (e.g.
 * `http://localhost:5000/uploads/public/profile/x.jpg`). next/image refuses those
 * unless the host is whitelisted, failing the request with
 * `400 "url" parameter is not allowed` — so the image silently never renders.
 *
 * next.config.ts rewrites `/uploads/public/*` to the backend, so the same
 * file is reachable same-origin. Only the PUBLIC class is served statically
 * (S-01, ADR-042 step 3): avatars, tenant logos, CMS images. Certificates and
 * attachments are never under `/uploads` any more — they are gated API routes.
 * Stripping the origin therefore makes the image a local one from
 * next/image's perspective, and works in dev and prod regardless of what the
 * backend's HOST_URL is set to.
 *
 * Anything that isn't an `/uploads/public/*` path (e.g. an external CDN
 * avatar) is returned untouched.
 */
/** The one static upload prefix the backend serves (ADR-042 step 3). */
export const PUBLIC_UPLOADS_PREFIX = "/uploads/public/";

export const toSameOriginUpload = (src: string): string => {
  try {
    // The base makes this safe for values that are already relative.
    const parsed = new URL(src, "http://placeholder.invalid");
    if (parsed.pathname.startsWith(PUBLIC_UPLOADS_PREFIX)) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Malformed URL — fall through and use it as-is.
  }
  return src;
};

/** The API prefix the Next `/api` proxy serves same-origin (ADR-046). */
export const API_PATH_PREFIX = "/api/v1/";

/**
 * F-11: a backend-issued API link as a same-origin path, or null.
 *
 * The backend hands out document links as root-relative API paths — the
 * public verification page's `documentUrl` is
 * `/api/v1/certificates/verify/<n>/document?token=…`
 * (certificatePdf.service.js mintDocumentUrl). The browser reaches `/api/`
 * through the Next proxy on the page's own origin, so the path is used as it
 * is. Prefixing `NEXT_PUBLIC_API_BASE_URL` sent the auditor's browser to the
 * backend origin, which the documented deployment does not publish.
 *
 * An absolute value is reduced to its path when that path is an API path;
 * anything else (another prefix, a malformed value) yields null — a link the
 * page cannot vouch for is not rendered.
 */
export const toSameOriginApiPath = (src: string | null | undefined): string | null => {
  if (!src) return null;
  try {
    const parsed = new URL(src, "http://placeholder.invalid");
    if (parsed.pathname.startsWith(API_PATH_PREFIX)) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Malformed — no link.
  }
  return null;
};

/**
 * The placeholder shown for a user who has never uploaded a photo.
 *
 * It lives in `frontend/public/`, NOT in the backend's uploads directory, and
 * that placement is the whole point. The backend stores the sentinel filename
 * `default.svg` in `users.avatar_url`, but nothing serves it: `/uploads` is a
 * runtime volume, `backend/uploads/` is gitignored so the file is not even in
 * a clean clone, and a bind mount would shadow it regardless. Every avatar in
 * the product was a broken image because of it.
 *
 * A placeholder is a UI concern. The backend reports "no avatar" as `null`;
 * the frontend decides what that looks like, and serves it same-origin from
 * its own static assets, where it cannot go missing.
 */
export const DEFAULT_AVATAR_SRC = "/default-avatar.svg";

/**
 * Resolve a user's avatar to something always renderable.
 *
 * @param picture - the `picture` field from the API, null when none was uploaded
 * @returns a same-origin URL — the uploaded image, or the default avatar
 */
export const avatarSrc = (picture?: string | null): string =>
  picture ? toSameOriginUpload(picture) : DEFAULT_AVATAR_SRC;

/**
 * `next/image` props for a user avatar.
 *
 * The `unoptimized` flag is load-bearing, and it was found by testing the
 * built image rather than by reasoning about it. next/image routes every src
 * through `/_next/image`, and that endpoint **rejects SVG with a 400** unless
 * `images.dangerouslyAllowSVG` is set:
 *
 *   GET /default-avatar.svg                    -> 200 image/svg+xml
 *   GET /_next/image?url=%2Fdefault-avatar.svg -> 400
 *
 * So the placeholder renders as a broken image — the exact bug it was added to
 * fix. Enabling `dangerouslyAllowSVG` globally would fix it and is the wrong
 * trade: uploaded avatars are user-supplied, and an SVG can carry script. This
 * bypasses the optimizer for OUR asset only and leaves uploaded SVGs blocked.
 *
 * @param picture - the `picture` field from the API, null when none was uploaded
 * @returns `src` plus `unoptimized`, set only for the placeholder
 */
export const avatarImageProps = (
  picture?: string | null,
): { src: string; unoptimized: boolean } => {
  const src = avatarSrc(picture);
  return { src, unoptimized: src === DEFAULT_AVATAR_SRC };
};

export default toSameOriginUpload;
