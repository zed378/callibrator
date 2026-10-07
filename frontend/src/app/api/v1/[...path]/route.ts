import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL, LONG_UPLOAD_PATHS, PROXY_UPLOAD_TIMEOUT_MS, PROXY_UPSTREAM_TIMEOUT_MS } from "@/constants";
import { CLIENT_ADDRESS_HEADERS, forwardedClientIp } from "@/lib/clientIp";
import { FORWARDED_ORIGIN_HEADERS, forwardedOriginHeaders } from "@/lib/forwardedOrigin";
import {
  AUTH_SESSION_COOKIE,
  sessionCookieOptions,
  writeSessionCookies,
} from "@/lib/authCookies";

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

/**
 * F-16: request headers that describe the incoming connection or its framing,
 * not the request. The body is re-sent as a stream, so the framing is
 * undici's to choose; `expect` (100-continue) is refused by undici outright.
 */
const HOP_REQUEST_HEADERS = ["transfer-encoding", "expect", "keep-alive", "upgrade"];

/**
 * F-16: whether a response body is read here, or streamed to the browser.
 *
 * Only a body that can carry an access token is read: a successful JSON
 * answer that is not a download. Those are what A-71 must inspect — the
 * sign-ins answered through this proxy (POST /auth/mfa/login,
 * /auth/impersonate) put the token at the top level — and they are small API
 * documents. Everything else — attachments, certificate PDFs, exports, error
 * bodies — streams through without being held in the Next process.
 *
 * A declared length over this ceiling is streamed too: no sign-in answer is a
 * megabyte, and a list that large should not be held here to look for one.
 */
const INSPECT_MAX_BYTES = 1024 * 1024;

const shouldInspect = (res: Response): boolean => {
  if (!res.ok) return false;
  if (!res.headers.get("content-type")?.includes("application/json")) return false;
  if (/attachment/i.test(res.headers.get("content-disposition") || "")) return false;
  const declared = Number(res.headers.get("content-length"));
  return !(Number.isFinite(declared) && declared > INSPECT_MAX_BYTES);
};

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
      !HOP_REQUEST_HEADERS.includes(lowercaseKey) &&
      !CLIENT_ADDRESS_HEADERS.includes(lowercaseKey) &&
      !FORWARDED_ORIGIN_HEADERS.includes(lowercaseKey)
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

  // A-189: the origin the request arrived on — `Host` is dropped above and
  // fetch sets the backend's own, so links the backend builds need this.
  for (const [name, value] of Object.entries(
    forwardedOriginHeaders(req.headers, req.nextUrl.protocol)
  )) {
    headers.set(name, value);
  }

  // A-68: the OIDC routes need the browser's sign-in binding (and only those).
  const ssoBinding = pathStr.startsWith(SSO_BINDING_PATH_PREFIX)
    ? cookieStore.get(SSO_BINDING_COOKIE)?.value
    : undefined;
  if (ssoBinding) {
    headers.set("Cookie", `${SSO_BINDING_COOKIE}=${ssoBinding}`);
  }

  // Inject authentication and tenant context headers.
  //
  // F-16, deliberate: an `Authorization` header the caller sent is forwarded
  // when there is no session cookie. nginx routes every `/api/` request to
  // Next (ADR-046, ADR-059), so this proxy is also the path of the machine
  // clients that authenticate with `Authorization: ApiKey <key>`
  // (auth.middleware tryApiKeyAuth). Forwarding it grants nothing the caller
  // does not already hold. A browser session's cookie always wins.
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

  // F-16: the request body is streamed to the backend as it arrives — an
  // upload is never held whole in the Next process. `duplex: "half"` is what
  // undici requires for a streamed request body.
  const body =
    req.method !== "GET" && req.method !== "HEAD" ? req.body : null;

  // F-14: the upstream fetch is bounded. Past PROXY_UPSTREAM_TIMEOUT_MS with no
  // response headers, or as soon as the browser goes away, it is aborted, so an
  // abandoned request does not keep running here. The timer stops once the
  // headers arrive: a long download is not cut off mid-stream.
  const upstream = new AbortController();
  let timedOut = false;
  // P24-06: a long upload answers only after its body has arrived; it gets its own budget.
  const longUpload = req.method === "POST" && LONG_UPLOAD_PATHS.includes(pathStr);
  const timer = setTimeout(() => {
    timedOut = true;
    upstream.abort();
  }, longUpload ? PROXY_UPLOAD_TIMEOUT_MS : PROXY_UPSTREAM_TIMEOUT_MS);
  const onClientGone = () => upstream.abort();
  req.signal?.addEventListener("abort", onClientGone, { once: true });

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
      signal: upstream.signal,
      ...(body ? { duplex: "half" } : {}),
    } as RequestInit);
    clearTimeout(timer);

    const responseHeaders = new Headers();
    res.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // - set-cookie: cookies are managed on the frontend
      // - content-encoding / content-length: fetch (undici) has already
      //   decompressed the body, so forwarding the original gzip encoding or
      //   byte length would make the browser fail to decode it
      //   (ERR_CONTENT_DECODING_FAILED) or truncate the response.
      // - transfer-encoding: framing is the response Next writes, not this one.
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

    // F-16: everything but a small successful JSON answer streams through.
    if (!shouldInspect(res)) {
      return new NextResponse(res.body, {
        status: res.status,
        headers: responseHeaders,
      });
    }

    const responseData = await res.arrayBuffer();

    // A-71: what the browser receives. A sign-in answered through this proxy
    // (POST /auth/mfa/login, /auth/impersonate) carries the access token at
    // the top-level `token`; it is written to the httpOnly cookie below and
    // REMOVED from the body — a script (an XSS) must never read it, which is
    // the point of the httpOnly cookie. The login route does the same (F-62).
    let browserBody: ArrayBuffer | string = responseData;
    try {
      const bodyText = new TextDecoder().decode(responseData);
      const data = JSON.parse(bodyText);

      if (data && typeof data === "object" && ("token" in data || "refreshToken" in data)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { token: _token, refreshToken: _refreshToken, ...withoutTokens } = data;
        browserBody = JSON.stringify(withoutTokens);
      }

      // F-05 (live run, 2026-09-29): the same writer as the login route, so
      // a session opened HERE keeps its refresh token. POST /auth/mfa/login —
      // how every MFA user (every platform operator) signs in — and
      // /auth/impersonate send a top-level `refreshToken` (auth.controller.js
      // login()), which this block used to strip from the body and drop: those
      // sessions could not be renewed and ended at the first expiry.
      if (data && typeof data.token === "string" && data.token) {
        writeSessionCookies(cookieStore, {
          token: data.token,
          sessionId: typeof data.session?.id === "string" ? data.session.id : null,
          refreshToken: typeof data.refreshToken === "string" ? data.refreshToken : null,
        });
      } else if (data && typeof data.session?.id === "string" && data.session.id) {
        cookieStore.set(AUTH_SESSION_COOKIE, data.session.id, sessionCookieOptions());
      }
    } catch {
      // Fail silently on JSON parse error
    }

    return new NextResponse(browserBody, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (error: unknown) {
    clearTimeout(timer);
    if (timedOut) {
      // F-14: the backend answers its own 408 at 30 s; reaching this means it
      // did not answer at all.
      return NextResponse.json(
        {
          success: false,
          status: 504,
          message: "The server did not respond in time. Please try again.",
        },
        { status: 504 }
      );
    }
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
  } finally {
    req.signal?.removeEventListener("abort", onClientGone);
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
