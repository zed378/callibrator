# Debate C-4: Session fixation, a concurrent-session limit, IP/user-agent binding (Q-08, superseding Q-04)

Debate paper · 2026-09-27/28 · decided in **ADR-084** (`../MEMORY/DECISIONS.md`). Both positions, then the referee.
Builds on ADR-034 (sessions live in the database), A-48 and **ADR-085** (every request checks the session is live;
sid-less tokens are refused; an open socket is re-checked every 60 s) and **ADR-072** (one own-password budget per
user; spending it signs that session out).

## The behaviour as the code has it (read 2026-09-27/28)

- **Fixation.** A session row and its `sid` are created only when authentication completes: `loginUser` for a
  password-only account, `loginMfa` after the second factor, the SSO callbacks, `refreshUserToken` (a new row per
  rotation), `impersonateUser`. The MFA password step issues an `mfa` purpose token with **no `sid`** and creates no
  session (A-59). Password change revokes every session; MFA enrolment or disable revokes every other one (A-141).
- **Concurrent sessions.** No limit. `MAX_CONCURRENT_SESSIONS` is read by nothing.
- **IP/UA binding.** None. `ip_address` and `user_agent` are recorded on the session at sign-in and refresh and never
  compared. The middleware that claimed binding was dead code, deleted under A-12.
- **Visibility.** A user can sign out this session or all sessions. There is no way to see one's own sessions or end
  one of them; the session list and per-session revoke are `SUPERADMIN` only (`routes/api/session.route.js`).
- **Sockets.** Since ADR-085 the handshake and a 60-second re-check apply the HTTP rule.

## Position A — compliance first

1. **Fixation:** OWASP ASVS V3.2.1 — a new token on authentication. Required, and must be pinned by a test so it
   stays true.
2. **Concurrent sessions:** NIST SP 800-53 AC-10 (concurrent session control) and credential sharing — a Part 11
   §11.300(a)/§11.10(d) concern. Offer a per-tenant cap, evicting the oldest.
3. **Binding:** a stolen token replayed from another network is the T2 threat (`docs/SECURITY/01`). Bind to the IP
   /24 or the user agent; re-authenticate on change.

## Position B — operability first

1. **Fixation:** agree; it is already structural.
2. **Cap:** clinicians sign in on a workstation, a ward tablet and a phone. A cap of one ends the session on the
   device in someone's hand when another is picked up — "one login silently kills another", which Q-08 names as the
   cost. A cap of N does not stop sharing an account N ways. And the thing sharing threatens most — attributable
   signatures — is already protected: every signature re-authenticates with the signer's own password (ADR-047), with
   a guessing budget per user (ADR-072).
3. **Binding:** hospital Wi-Fi hands a different address per floor, mobile networks rotate addresses, and the
   deployment sits behind Cloudflare (`ADR-050`: one client address, resolved at the edge). IP binding is a logout
   generator. User-agent binding is trivially spoofed by anyone who stole a token, so it inconveniences only the real
   user after a browser update.
4. What actually catches a stolen or shared session is **the user seeing it**: where it signed in, from what, and a
   button to end it (ASVS V3.3.4).

## Where they agree

- Fixation protection by construction, pinned.
- Revocation must bite on the next request and on open sockets (done: A-48, ADR-085).
- A user must be able to see and end their own sessions.

## Referee's decision (ADR-084, Q-08 and Q-04)

| Control | Decision |
|---|---|
| Session fixation | **Required, and already structural.** A `sid` is minted only when authentication completes, a new row each time; nothing before authentication carries one. Pinned by `auth.sessionFixation.q08.test.js` |
| Concurrent-session limit | **None** — neither platform-wide nor per tenant. `MAX_CONCURRENT_SESSIONS` stays unread |
| IP / user-agent binding | **None.** A changed address or browser never ends a session. Both stay recorded at sign-in and refresh, and are shown to the user |
| The control instead | **`GET /api/v1/sessions/mine`** (every live session of the caller: recorded address and browser, sign-in method, created/last activity/expiry, *this* session, whether it is a platform operator's support session — the operator's identity is not disclosed) and **`POST /api/v1/sessions/mine/:id/revoke`** (ends one; another user's session is 404; the revocation and an `UPDATE` audit row `operation: "REVOKE_OWN_SESSION"` in one transaction; its token dies on the next request, its sockets at the next re-check). API keys are refused. Pinned by `session.own.q08.test.js` |
| Sockets | **The same rule as HTTP**, applied at the handshake and re-checked every 60 s while open — ADR-085, unchanged. Not stricter: two answers to "is this session valid" is the defect shape Q-08 warned about |

**Why B on the cap and binding, A on fixation:** AC-10 is a *High*-baseline control and optional below it; the
credential-sharing harm A cites is already closed at the point that matters (signing re-authenticates, ADR-047/072);
a cap either breaks multi-device clinicians or does not stop sharing. Binding punishes the legitimate user on exactly
the networks this product runs on, and the T2 threat is answered by per-request revocation plus a user who can see
the session.

**Left open:**
- Re-authentication before ending *another* session (ASVS V3.3.4 says "having re-entered login credentials"). Not
  required here, consistent with `logout-all`, because ending a session only reduces access. Revisit if the list ever
  gains a destructive neighbour.
- A new-device sign-in notification (email) — a natural next step for detection, not built.
- The frontend page for the session list is not built (frontend board).
