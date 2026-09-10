# 14 — Public Surfaces UX

Everything reachable without a session: the landing page, blog, news, auth screens, and the certificate verification page.

Design detail for the landing and content surfaces is in [`19-IMMERSIVE-REVAMP-PLAN.md`](./19-IMMERSIVE-REVAMP-PLAN.md). This document covers what governs all of them.

---

## Two Registers, One Boundary

| Surface | Register | Motion budget |
|---|---|---|
| Landing, blog, news | confident, evidenced, unhurried | permitted |
| Auth screens | quiet, fast | minimal |
| **Verification page** | **none** | **zero** |

The public surfaces may spend a budget on impression. The dashboard may not. The verification page is public and spends nothing — it is a working tool that happens to live on the public side.

## The Verification Page

`/verify/[certificateNumber]`. The one public route that is functionally load-bearing rather than marketing.

```
        ┌───────────────────────────┐
        │         V A L I D         │  ← display size
        └───────────────────────────┘
   Device        Infusion Pump · IP-2024-00871
   Calibrated    14 Mar 2026
   Valid until   14 Mar 2027
   Issued by     Lab Kalibrasi X
```

| Rule | Why |
|---|---|
| No login, ever | a certificate only insiders can check is not evidence |
| Verdict first, at `display` size | read at arm's length off someone else's phone |
| The **word** carries the message | poor light, colour vision deficiency, photocopies |
| Four verdicts: VALID · EXPIRED · REVOKED · NOT FOUND | |
| **"Not found" and "signature mismatch" render identically** | otherwise it is a certificate-number oracle |
| No animation, no heavy dependencies | the auditor wants the answer, not a reveal |
| Nothing consequential below the fold | |
| Works on an untested phone in unknown conditions | they bring their own device |

Reached by scanning the QR on a certificate PDF, which encodes `CERT_VERIFY_BASE_URL/<certificateNumber>`.

**Nobody who works on the product uses this screen.** It is the first forgotten in a redesign and the last tested, which is why it has its own line in the release checklist.

## Landing

Audience: evaluators and procurement, not users. They are deciding whether this software can survive an accreditation surveyor.

| Section | Job |
|---|---|
| Hero | what this is, in one sentence a hospital director understands |
| Trust | the standards — ISO 17025, 21 CFR Part 11, ISO 13485, KARS, SNARS |
| How it works | device → calibration → certificate → verification |
| Features | the operational surface, without listing 33 modules |
| Compliance | the evidence story |
| Pricing | plans |
| CTA | |

**Do not enumerate all 33 modules.** A feature list that long reads as unfocused. Show the calibration spine and let the rest be discovered.

The most persuasive thing available is the verification page itself — a live, working link an evaluator can try.

## Auth Screens

`/login`, `/register`.

Deliberately plain. WebGL-free, fast to interactive — someone signing in at 6am is not an audience for a scene.

### Tenant-pinned branding

For a build with `NEXT_PUBLIC_TENANT_ID`, branding is fetched from `GET /tenants/public` **before sign-in**, so the login page is already branded with the tenant's logo, name and colour.

That endpoint is **unauthenticated and must expose branding only**. Anything else on it is a pre-auth disclosure.

### Failure states, each distinct

| State | Message |
|---|---|
| Bad credentials | uniform — never revealing whether the account exists |
| Locked | says it is locked, and roughly for how long |
| **Suspended tenant** | says the organisation account is suspended |
| Rate limited | says to wait, with the window |

The suspended-tenant case must **not** be disguised as bad credentials. The user cannot fix it and needs to know that someone else must.

Bad credentials must look identical whether or not the account exists, and `/send-otp` must respond identically whether or not the address is known.

## Blog and News

Backed by `posts` — `type` of `BLOG` or `NEWS`, `status` `DRAFT` / `PUBLISHED` / `ARCHIVED`, addressed by `slug`.

`posts` is **global, not tenant-scoped**: this is platform marketing, not tenant data.

| Rule | |
|---|---|
| Measure 65–75 characters | |
| Author byline is **denormalised** | it survives the author account being deactivated or anonymised |
| Reading time from `readingMinutes` | |
| Categories from `post_categories` | |

### `contentHtml` is the stored-XSS surface

Authored in TipTap and rendered into a public page. Two controls, both required:

1. **Sanitise on ingest.** Sanitising only on render leaves the payload in the database for any other consumer.
2. **A CSP that does not permit inline script** on the pages that render it.

The API origin's CSP allows `'unsafe-inline'` because bundled swagger-ui needs it. **That reasoning does not transfer to the Next.js origin** serving these pages, which should be stricter.

## Performance

| Target | |
|---|---|
| Lighthouse performance | 90+ |
| Verification page interactive | as fast as achievable — it is the one measured on a stranger's phone |
| Landing motion | never blocks first paint |

The landing page may be heavy. The verification page may not.

## SEO

Landing, blog and news carry full metadata, Open Graph and structured data.

**The verification page must not be indexed.** Certificate numbers in a search index are an enumeration surface, and the page has no value to a search engine — it is a lookup tool, not content.

## Accessibility

Everything in [`17-ACCESSIBILITY.md`](./17-ACCESSIBILITY.md) applies, and applies hardest here: the verification page is used once, by someone with no training, on their own device, possibly in poor light, and the outcome carries regulatory weight.

`prefers-reduced-motion` is honoured on the landing page as a full alternative, not a degraded one.
