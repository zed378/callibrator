import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";

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
  
  // Copy incoming headers (skip host, origin, connection, and cookie to avoid conflicts)
  req.headers.forEach((value, key) => {
    const lowercaseKey = key.toLowerCase();
    if (
      lowercaseKey !== "host" &&
      lowercaseKey !== "origin" &&
      lowercaseKey !== "connection" &&
      lowercaseKey !== "cookie"
    ) {
      headers.set(key, value);
    }
  });

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
    const res = await fetch(url, {
      method: req.method,
      headers,
      body,
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
