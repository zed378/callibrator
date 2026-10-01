/**
 * P7-08 / ADR-071 (amendment): a tenant logo is an UPLOADED file name, never a
 * URL (the full rule is in the canonical definition).
 *
 * P9-22 (ADR-097): STORED_LOGO_NAME is canonical in
 * `@callibrator/contracts/tenantLogo`, because the tenant request schema is a
 * contract; this module re-exports the same RegExp object, so the tenant
 * validator and tenant.service's logo URL builder read one pattern.
 */
export { STORED_LOGO_NAME } from "@callibrator/contracts/tenantLogo";
