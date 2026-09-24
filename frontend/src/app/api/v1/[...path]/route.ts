import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";
import { CLIENT_ADDRESS_HEADERS, forwardedClientIp } from "@/lib/clientIp";

/**
 * A-68/A-69 — the one backend cookie this proxy carries, in both directions.
 *
 * The backend binds an OIDC sign-in to the browser that started it with this
 * httpOnly cookie (sso.controller, beginOidcFlow): set by
 * POST /auth/sso/oidc/login, read and cleared by the callback. Every other
 * backend Set-Cookie is still dropped and no other browser cookie is
 * forwarded — Next owns the session cookies.
 */
const SSO_BINDING_COOKIE = "sso_oidc_binding";
const SSO_BINDING_PATH_PREFIX = "auth/sso/oidc/";

async function handleProxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = path.join("/");
  const url = `${API_BASE_URL}/api/v1/${pathStr}${req.nextUrl.search}`;

  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  const session = cookieStore.get("auth_session")?.value;
  // Prefer the client-writable cookie (lets a logged-in super-admin switch
  // tenants); otherwise fall back to the deploy-configured tenant so that a
  // single-tenant frontend always sends X-Tenant-ID, even before login.
  const tenantId =
    cookieStore.get("x_tenant_id")?.value || process.env.NEXT_PUBLIC_TENANT_ID;

  const headers = new Headers();
  
  // Copy incoming headers (skip host, origin, connection, and cookie to avoid
  // conflicts). A-16: every client-address header is skipped too — as they
  // arrive they may be the browser's own — and ONE sanitized address is set in
  // their place below.
  req.headers.forEach((value, key) => {
    const lowercaseKey = key.toLowerCase();
    if (
      lowercaseKey !== "host" &&
      lowercaseKey !== "origin" &&
      lowercaseKey !== "connection" &&
      lowercaseKey !== "cookie" &&
      !CLIENT_ADDRESS_HEADERS.includes(lowercaseKey)
    ) {
      headers.set(key, value);
    }
  });

  // The address nginx forwarded — the only one the backend's one-hop
  // `trust proxy` will read (src/lib/clientIp.ts).
  const clientIp = forwardedClientIp(req.headers);
  if (clientIp) {
    headers.set("X-Forwarded-For", clientIp);
  }

  // A-68: the OIDC routes need the browser's sign-in binding (and only those).
  const ssoBinding = pathStr.startsWith(SSO_BINDING_PATH_PREFIX)
    ? cookieStore.get(SSO_BINDING_COOKIE)?.value
    : undefined;
  if (ssoBinding) {
    headers.set("Cookie", `${SSO_BINDING_COOKIE}=${ssoBinding}`);
  }

  // Inject authentication and tenant context headers
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (session) {
    headers.set("X-Session", session);
  }
  if (tenantId) {
    // X-Tenant-ID is derived from the client-writable x_tenant_id cookie and is
    // therefore untrusted. The BACKEND is the enforcement boundary: it only
    // honours this header for SUPER_ADMIN accounts (see backend auth middleware)
    // and otherwise binds the tenant from the authenticated token. Never rely on
    // this header alone for tenant isolation.
    headers.set("X-Tenant-ID", tenantId);
  }

  // Get raw body as ArrayBuffer for binary compatibility (handles multipart/form-data upload)
  let body: ArrayBuffer | undefined = undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  try {
    // A-69: a redirect is the BROWSER's to follow. fetch follows 3xx by
    // default, so the OIDC callback's 302 to /sso-callback was followed here,
    // on the server: the browser got that page's HTML under the callback URL
    // and never the one-time code. `manual` hands the 3xx and its Location
    // (copied with the other headers below) back to the browser.
    const res = await fetch(url, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });

    const responseData = await res.arrayBuffer();
    
    const responseHeaders = new Headers();
    res.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // - set-cookie: cookies are managed on the frontend
      // - content-encoding / content-length: fetch (undici) has already
      //   decompressed the body, so forwarding the original gzip encoding or
      //   byte length would make the browser fail to decode it
      //   (ERR_CONTENT_DECODING_FAILED) or truncate the response.
      // - transfer-encoding: no longer applies to the buffered body.
      if (
        lower === "set-cookie" ||
        lower === "content-encoding" ||
        lower === "content-length" ||
        lower === "transfer-encoding"
      ) {
        return;
      }
      responseHeaders.set(key, value);
    });
    // A-68: ...except the OIDC sign-in binding, which must reach the browser.
    for (const line of res.headers.getSetCookie()) {
      if (line.startsWith(`${SSO_BINDING_COOKIE}=`)) {
        responseHeaders.append("set-cookie", line);
      }
    }

    // Check if response contains a rotated token/session in JSON
    const isJson = res.headers.get("content-type")?.includes("application/json");
    if (isJson && res.ok) {
      try {
        const bodyText = new TextDecoder().decode(responseData);
        const data = JSON.parse(bodyText);
        
        if (data && (data.token || data.session?.id)) {
          const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax" as const,
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
          };
          if (data.token) {
            cookieStore.set("auth_token", data.token, cookieOptions);
          }
          if (data.session?.id) {
            cookieStore.set("auth_session", data.session.id, cookieOptions);
          }
        }
      } catch {
        // Fail silently on JSON parse error
      }
    }

    return new NextResponse(responseData, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Proxy connection error";
    // When the backend rejects an upload mid-stream (e.g. multer's file-size
    // limit) it responds and resets the connection before the body is fully
    // sent, so fetch throws a bare "fetch failed". Give the user something
    // actionable instead of that.
    const isUpload = req.headers
      .get("content-type")
      ?.includes("multipart/form-data");
    return NextResponse.json(
      {
        success: false,
        message: isUpload
          ? "Upload failed — the file may exceed the server's size limit or be an unsupported type."
          : message,
      },
      { status: 502 }
    );
  }
}

export {
  handleProxy as GET,
  handleProxy as POST,
  handleProxy as PUT,
  handleProxy as DELETE,
  handleProxy as PATCH,
  handleProxy as OPTIONS,
};
