/**
 * P7-08 / ADR-071 (amendment): a tenant logo is an UPLOADED file, named by the
 * upload middleware (`<ms>-<n>-<uuid><ext>`, utils/upload.util.js) and served
 * from /uploads/public/tenant/. It is never a URL. An absolute URL would be
 * hotlinked (every viewer's IP and Referer sent to a third party), and the
 * content origin's `img-src` blocks it anyway.
 *
 * A bare file name only: no scheme, no slash, no backslash, no leading dot.
 * Used by the tenant validator (what may be written) and by the logo URL
 * builder in tenant.service (what may be served).
 */
const STORED_LOGO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

module.exports = { STORED_LOGO_NAME };
