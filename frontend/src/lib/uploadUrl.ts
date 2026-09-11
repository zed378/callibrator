// src/lib/uploadUrl.ts

/**
 * Normalise a backend upload URL for use with next/image.
 *
 * The backend builds ABSOLUTE upload URLs from its own HOST_URL (e.g.
 * `http://localhost:5000/uploads/profile/x.jpg`). next/image refuses those
 * unless the host is whitelisted, failing the request with
 * `400 "url" parameter is not allowed` — so the image silently never renders.
 *
 * next.config.ts already rewrites `/uploads/*` to the backend, so the same
 * file is reachable same-origin. Stripping the origin therefore makes the
 * image a local one from next/image's perspective, and works in dev and prod
 * regardless of what the backend's HOST_URL is set to.
 *
 * Anything that isn't an `/uploads/*` path (e.g. an external CDN avatar) is
 * returned untouched.
 */
export const toSameOriginUpload = (src: string): string => {
  try {
    // The base makes this safe for values that are already relative.
    const parsed = new URL(src, "http://placeholder.invalid");
    if (parsed.pathname.startsWith("/uploads/")) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Malformed URL — fall through and use it as-is.
  }
  return src;
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
