/**
 * The contract of `userEsignatures.route.ts`, code-first (ADR-103): personal e-signatures (P21-15;
 * ADR-140; spec MEMORY/specs/P21-15-operator-esignature.md v2 § 4). Examples are synthetic.
 */
import { z } from "zod";
import { createMyEsignature, myApplicationsQuery, revokeMyEsignature, revokeUserEsignatureBody, signDocument } from "@callibrator/contracts/esignatures";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { EsignatureApplication, MyEsignature, MyEsignatureState } from "../../docs/openapi/esignatureSchemas";

const read = { kind: "dynamicAccess", resource: "esignature", action: "read" } as const;
const write = { kind: "dynamicAccess", resource: "esignature", action: "write" } as const;
const tenantAdmin = { kind: "rbac", roles: ["TENANT_ADMIN"] } as const;
const REAUTH = "The caller re-enters a credential (password or a current MFA code); a wrong one is 401 and a `SIGNATURE_AUTH_FAILED` audit row. Per user and address 10 per 15 minutes.";

export default defineRouteDocs({
  router: "api/userEsignatures.route",
  mount: "/api/v1/esignature",
  tag: "Personal E-signatures",
  tagDescription: "Every user's own e-signature — a specimen and a personal key — applied to records and documents, each application publicly verifiable (ADR-140)",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/me",
      operationId: "getMyEsignature",
      summary: "My e-signature and its earlier versions",
      description: "The active e-signature (specimen, key fingerprint, version) or null, and the earlier versions. Never a private key.",
      permission: read,
      audited: false,
      success: { status: 200, description: "My e-signature state", data: MyEsignatureState },
    },
    {
      method: "post",
      path: "/me",
      operationId: "createMyEsignature",
      summary: "Create my e-signature, or replace the active one",
      description:
        "The specimen is sanitised SVG (paths and shapes only, or one PNG/JPEG data-URI image; no script, text or external reference; ≤ 64 KB, ≤ 256 KB with " +
        "an image) — anything else is 400 `ESIG_SPECIMEN_INVALID`. An RSA-3072 key pair is generated on the server and its private half wrapped under the KMS " +
        "ring; it is never returned. A replacement makes the old version `superseded` (it still verifies what it signed). The platform operator has no tenant " +
        `(403 \`ESIG_PLATFORM\`). ${REAUTH}`,
      permission: write,
      audited: true,
      body: createMyEsignature,
      success: { status: 201, description: "The new version", data: MyEsignature },
    },
    {
      method: "post",
      path: "/me/revoke",
      operationId: "revokeMyEsignature",
      summary: "Revoke my e-signature",
      description: `"Do not use from now on": past applications still verify, and their public page shows the revocation. ${REAUTH}`,
      permission: write,
      audited: true,
      body: revokeMyEsignature,
      conflict: "`ESIG_NONE`: there is no active e-signature to revoke.",
      success: { status: 200, description: "The revoked version", data: MyEsignature },
    },
    {
      method: "get",
      path: "/me/applications",
      operationId: "listMyEsignatureApplications",
      summary: "What I have signed",
      description: "Newest first; rows in `data`, the page in the top-level `meta`. `integrity` is null here (not recomputed).",
      permission: read,
      audited: false,
      query: myApplicationsQuery,
      success: { status: 200, description: "A page of my applications", list: EsignatureApplication },
    },
    {
      method: "post",
      path: "/documents",
      operationId: "signDocumentByHash",
      summary: "Sign any document by its SHA-256",
      description:
        "The browser hashes the file; the server receives only the hash, the title and the size — the file is never uploaded or stored. The application is " +
        `signed with the caller's personal key and gets its own public verification link. The platform tenant authors nothing here (403, A-127). ${REAUTH}`,
      permission: write,
      audited: true,
      body: signDocument,
      conflict: "`ESIG_NONE`: create your e-signature first, in Profile → E-signature.",
      success: { status: 201, description: "The application", data: EsignatureApplication },
    },
    {
      method: "post",
      path: "/users/:userId/revoke",
      operationId: "revokeUserEsignature",
      summary: "Revoke another user's e-signature (tenant administrator)",
      description:
        "A tenant administrator (`rbac`) who also holds `qms` write revokes a user's active e-signature (a departed employee). It never creates or replaces one. " +
        "Another tenant's or a missing user: 404. The platform tenant authors nothing here (403, A-127).",
      permission: tenantAdmin,
      audited: true,
      params: z.object({ userId: z.guid().meta({ description: "The user", example: "7c8d9e0f-1a2b-4c3d-9e4f-5a6b7c8d9e0f" }) }),
      body: revokeUserEsignatureBody,
      conflict: "`ESIG_NONE`: the user has no active e-signature.",
      success: { status: 200, description: "The revoked version", data: MyEsignature },
    },
  ],
});
