# 03 — Reverse Proxy

nginx. Configuration: [`../../deploy/compose/nginx/`](../../deploy/compose/nginx/).

---

## Routing

| Path | Upstream | Note |
|---|---|---|
| **`/api/*`** | **frontend** | **not the backend — see below** |
| `/socket.io/*` | backend | **needs the WebSocket upgrade headers** |
| `/oidc/*` | backend | **at the root**, not under `/api/v1` |
| `/.well-known/*` | backend | ACME HTTP-01 challenges |
| `/uploads/*` | backend | preserve the security headers |
| everything else | frontend | |

Three of these are easy to miss and all fail confusingly.

## `/api/*` — routing it to the backend breaks authentication

**This one was got wrong in a real deployment**, and the symptom pointed nowhere near the cause: the login page rendered, credentials were correct, the backend returned 200 — and the user still could not log in.

Next.js **owns** `/api/v1/*` in this application:

| Route | Does |
|---|---|
| `app/api/v1/auth/login/route.ts` | forwards to the backend, then sets the **httpOnly `auth_token` cookie** |
| `app/api/v1/[...path]/route.ts` | catch-all proxy; injects `Authorization: Bearer` **from that cookie** on every later call |

`frontend/src/api/client.ts` sets `baseURL: ""` precisely because of this — the browser talks to its own origin and Next does the rest.

Routing `/api/` straight to the backend bypasses both handlers:

- login returns a token in the JSON body that **nothing stores**, and no cookie is set;
- every authenticated request afterwards arrives at the backend **with no credentials**.

```nginx
location /api/ {
    proxy_pass http://frontend;   # NOT http://backend
}
```

Next then reaches the backend server-side via **`BACKEND_INTERNAL_URL`** (e.g. `http://backend:3000`). That variable exists because `NEXT_PUBLIC_API_BASE_URL` is read from two places with different reachability needs — the server-side proxy and browser Socket.IO — and pointing the server-side hop at the public origin makes it **re-enter the proxy that called it and loop**.

## `/socket.io/*` — the silent failure

```nginx
location /socket.io/ {
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;
    proxy_read_timeout 3600s;
}
```

**Without the upgrade headers, Socket.IO silently falls back to long-polling.**

It works. Notifications arrive. Nothing errors. Nobody notices — until connection counts matter, at which point the server is holding far more open requests than anyone expected, and the diagnosis starts in entirely the wrong place.

This is the deployment mistake most likely to go undetected in this system.

`proxy_read_timeout` must be long. The default 60 seconds kills idle WebSocket connections and produces a reconnect storm that looks like network instability.

## `/oidc/*` — at the root, not under the API prefix

```nginx
location /oidc/ {
    proxy_pass http://backend:3000;
}
```

The discovery document advertises its endpoints at `<issuer>/oidc/...`, where the issuer is the **host root**. Relying parties fetch `/oidc/.well-known/openid-configuration` and `/oidc/.well-known/jwks.json` directly.

The backend mounts the OIDC router **twice** for this reason. Routing only `/api/*` produces a discovery document nobody can follow, and the relying party's error will not mention the proxy.

## `/.well-known/*` — ACME challenges

Must reach the backend, which serves them from `storagePath(".well-known")` — the **writable** storage root, because challenge files are written at runtime.

If this path is intercepted by nginx or by a static handler, domain verification fails with an error that looks like a DNS problem, which sends the investigation the wrong way entirely.

## TLS

```nginx
listen 443 ssl http2;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

Port 80 redirects to 443 — **except** `/.well-known/acme-challenge/`, which must stay reachable over HTTP for HTTP-01 validation.

The backend also has `FORCE_HTTPS`, which redirects when `X-Forwarded-Proto` is not `https`. Both layers, deliberately: the proxy handles it normally, and the application does not depend on the proxy being configured correctly.

## Headers to Forward

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

`X-Forwarded-For` is not cosmetic here. It reaches:

| Consumer | Uses it for |
|---|---|
| `sessions.ip_address` | session binding |
| `audit_logs.ipAddress` | attribution |
| `e_signature_records.ipAddress` | **21 CFR Part 11 evidence** |
| `consent_records.ipAddress` | GDPR |
| Rate limiters | per-source counting |

**Without it every request appears to come from the proxy.** Session binding becomes meaningless, per-source rate limiting collapses into one bucket, and the signature evidence records the wrong address — which is a compliance defect, not an operational one.

Express must be configured to trust the proxy for `req.ip` to reflect the real client.

`X-Forwarded-Proto` is what `FORCE_HTTPS` reads. Omitting it produces a redirect loop.

## Body Size

```nginx
client_max_body_size 10m;
```

Match the application's 10 MB limit. A smaller nginx limit produces a 413 from the proxy that the application never sees and cannot explain; a larger one lets a body through that the application then rejects, having already transferred it.

## Timeouts

| Setting | Value | Why |
|---|---|---|
| `proxy_read_timeout` (general) | 60s | the app times out at 30s and returns 408 |
| `proxy_read_timeout` (`/socket.io/`) | 3600s | long-lived connections |

## Static Uploads

`/uploads/*` proxies to the backend, which serves with:

```
X-Content-Type-Options: nosniff
Content-Disposition: inline
```

**nginx must not strip or override these.** They are the defence against a browser sniffing an upload into active content, and helmet sets `crossOriginResourcePolicy: cross-origin` so the separate-origin frontend can load these images — which is precisely why the two headers are not optional.

## Compression

The backend already applies `compression()`. Enabling gzip in nginx as well double-compresses.

Pick one layer. If nginx, disable it in the application.

## Health

```nginx
location /health {
    proxy_pass http://backend:3000/health;
    access_log off;
}
```

`access_log off` because a probe every 30 seconds otherwise dominates the log.

`/health` returns **503** when the database is unreachable — an upstream returning 503 should be taken out of rotation, not restarted.

## Custom Domains

A tenant may register its own domain, DNS-verify it, and have TLS provisioned over ACME.

Two requirements on this layer:

1. `/.well-known/acme-challenge/` reachable over **HTTP** on every domain,
2. dynamic certificate loading, or a reload after issuance.

`ACME_DIRECTORY_URL` **defaults to the Let's Encrypt staging directory**. Forgetting to point it at production yields certificates no browser trusts, and the failure appears in a browser rather than in any log.

## Checklist

- [ ] **`/api/` proxies to the FRONTEND, not the backend**
- [ ] `BACKEND_INTERNAL_URL` is set for the frontend container
- [ ] `/socket.io/` has the upgrade headers and a long read timeout
- [ ] `/oidc/` is routed at the **root**
- [ ] `/.well-known/acme-challenge/` reaches the backend over HTTP
- [ ] `X-Forwarded-For` and `X-Forwarded-Proto` are set
- [ ] Express trusts the proxy
- [ ] `client_max_body_size` matches 10 MB
- [ ] `/uploads` security headers are preserved
- [ ] compression is enabled in exactly one layer
- [ ] HSTS present, TLS 1.2 minimum
- [ ] the health probe is not logged
