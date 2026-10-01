/**
 * P7-08 / ADR-071 (amendment): a tenant logo is an UPLOADED file, named by the
 * upload middleware (`<ms>-<n>-<uuid><ext>`, utils/upload.util.js) and served
 * from /uploads/public/tenant/. It is never a URL. An absolute URL would be
 * hotlinked (every viewer's IP and Referer sent to a third party), and the
 * content origin's `img-src` blocks it anyway.
 *
 * A bare file name only: no scheme, no slash, no backslash, no leading dot.
 * Used by the tenant request schema (what may be written) and by the logo URL
 * builder in the backend's tenant.service (what may be served).
 *
 * P9-22 (ADR-097): canonical here since the tenant schemas became a contract;
 * backend/src/constants/tenantLogo.ts re-exports this same RegExp object.
 */
export const STORED_LOGO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
