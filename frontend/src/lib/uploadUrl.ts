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

export default toSameOriginUpload;
