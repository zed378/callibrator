/**
 * attachment request schemas.
 *
 * A-365 (F-1 of docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md § 9): the body
 * of `POST /attachments/:id/signed-url`. Until A-365 the controller read
 * `expiresInSec` raw and the service accepted any positive number, so a link
 * could be made to live for years. It is now an integer in
 * [SIGNED_URL_MIN_TTL_SEC, the configured cap] (config/signedUrl.ts), checked
 * against the cap read at REQUEST time so a changed configuration applies
 * without a rebuilt schema; the static `.max` is the hard ceiling the cap can
 * never exceed, which the published contract states.
 *
 * Kept here rather than in `@callibrator/contracts`: the cap is server
 * configuration, and the frontend sends no lifetime (it takes the default).
 */
import { z } from "zod";
import { SIGNED_URL_HARD_MAX_TTL_SEC, SIGNED_URL_MIN_TTL_SEC, signedUrlMaxTtlSec } from "../config/signedUrl";

export const createSignedUrlSchema = z
  .object({
    expiresInSec: z
      .number()
      .int()
      .min(SIGNED_URL_MIN_TTL_SEC)
      .max(SIGNED_URL_HARD_MAX_TTL_SEC)
      .superRefine((value, ctx) => {
        const cap = signedUrlMaxTtlSec();
        if (value > cap) {
          ctx.addIssue({ code: "custom", message: `A download link lives at most ${String(cap)} seconds` });
        }
      })
      .optional()
      .meta({
        description:
          "Lifetime in seconds: an integer from 30 to the configured cap (ATTACHMENT_URL_MAX_TTL_SEC, default 900, never above 3600). Without it, ATTACHMENT_URL_TTL_SEC applies (default 300). Above the cap: 400",
        example: 300,
      }),
  })
  .meta({ description: "Optional; an empty body takes the default lifetime" });
