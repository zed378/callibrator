# Phase 39 — Mobile Roles, Tablet, Push, SSO and Passkeys

> Part of the **mobile group, Phases 35 … 40 (one plan)** ([Phase 35](./PHASE-35-SHARED-PACKAGES.md)).
> Specs: [`docs/MOBILE/02`](../docs/MOBILE/02-SCREENS-AND-ROLES.md), [`03`](../docs/MOBILE/03-RESPONSIVE-PHONE-TABLET.md),
> [`05`](../docs/MOBILE/05-NATIVE-FEATURES.md), [`06`](../docs/MOBILE/06-AUTH-FLOWS.md), [`10`](../docs/MOBILE/10-ACCESSIBILITY-AND-I18N.md).
>
> ← [Phase 38](./PHASE-38-MOBILE-FIELD-CAPTURE.md) · [Phase 40](./PHASE-40-MOBILE-RELEASE.md) →

| | |
|---|---|
| **Status** | **BLOCKED** — 7 cards: 7 BLOCKED (written 2026-10-08; nothing built) |
| **Goal** | every user group of the owner's brainstorm has its screens — facility staff, IPSRS, auditors, managers — on phone and tablet; push, hospital SSO, passkeys and app links work |
| **Depends on** | P37-08; P36-04, P36-05, P36-06, P36-08; Q-M2 (production hosts) answered for P39-05/06 |
| **Size** | L |
| **Cards** | 7: P39-01 … P39-07 (may run beside Phase 38 once P37-08 is DONE) |
| **Definition of Done** | as Phase 37 |

## Cards

### P39-01 — Facility staff and IPSRS screens, bound-user rules, online signing

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-08, P36-08 |
| **Spec refs** | `docs/MOBILE/02` §§ 2.2–2.3, 3 · ADR-124 Am. 1 · ADR-126 Am. 2 (signatures) |
| **Spec required** | no |

**Definition of Done**
- [ ] The facility inventory, IPM history and reports for bound users; writes offered only where `canInvoke` allows (`x-facility-accessible`)
- [ ] Performer signature and IPSRS countersignature online, re-entered password (+ MFA per method); a wrong password never signs out (credential endpoint)
- [ ] Two-facility checks in Maestro: a bound user never sees another facility's device; `ipm.sign`

### P39-02 — Auditor verification (signed out) and manager dashboards

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-08 |
| **Spec refs** | `docs/MOBILE/02` §§ 2.4–2.5 · `docs/MOBILE/03` § 6 · ADR-100 · ADR-120 |
| **Spec required** | no |

**Definition of Done**
- [ ] Certificate and IPM-report verification by scan or link, signed out, with the same verdict wording as `/verify`
- [ ] Dashboards from the cached aggregates, per role; tablet multi-pane
- [ ] Maestro `verify.public`, dashboard flows

### P39-03 — Tablet layouts: split view, two-column checklist, landscape, hardware keyboard

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P38-03 |
| **Spec refs** | `docs/MOBILE/03` §§ 4–8 · `docs/SHARED/02` § 8 |
| **Spec required** | no |

**Definition of Done**
- [ ] Master-detail from the window classes; selection survives rotation; the two-column checklist; focus order with a hardware keyboard; Dynamic Type to 200 % without loss
- [ ] Maestro `tablet.split-view` on an iPad simulator and an Android tablet emulator

### P39-04 — Push notifications

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-08, P36-04 |
| **Spec refs** | `docs/MOBILE/05` § 3 · `docs/MOBILE/20` § 10 |
| **Spec required** | no |

**Definition of Done**
- [ ] Native device tokens registered after sign-in, re-registered on rotation, deleted on sign-out; permission asked in context
- [ ] Generic alerts by category; content fetched after unlock; `scope_check` triggers `/auth/verify`
- [ ] Real-device check: a lock-screen alert carries no personal data (script step 7)

### P39-05 — Hospital SSO through the system browser and the app link

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-04, P36-05, P36-06 |
| **Spec refs** | `docs/MOBILE/06` § 3 · `docs/MOBILE/20` §§ 2a.3, 7 |
| **Spec required** | no |

**Definition of Done**
- [ ] Start by tenant code with PKCE, `openAuthSessionAsync` with the per-platform callback fixed by P36-05's device spike (`docs/MOBILE/20` § 7.1: https callback on iOS 17.4+, the private reverse-domain scheme only as the auth-session callback on iOS 16 – 17.3), state check, exchange
- [ ] Maestro `signin.sso` against a test IdP (a forged `state` refused)

### P39-06 — Native passkeys and app links

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-04, P36-06 |
| **Spec refs** | `docs/MOBILE/06` § 4 · `docs/MOBILE/05` § 5 · `docs/MOBILE/20` § 8 |
| **Spec required** | no |

**Definition of Done**
- [ ] Passkey registration (after re-authentication) and sign-in on both platforms with the platform RP ID; the module chosen under the package rule and recorded
- [ ] Verification, SSO-return and setup links open the app; association files verified on every host in the binary
- [ ] Maestro `signin.passkey` where the platform allows; otherwise the real-device script

### P39-07 — Accessibility and language pass, phase exit

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P39-01 … P39-06 |
| **Spec refs** | `docs/MOBILE/10` · `docs/MOBILE/09` § 6 |
| **Spec required** | no |

**Definition of Done**
- [ ] TalkBack and VoiceOver walks of the capture stepper, the verify screen and sign-in, recorded as named runs; every string in Indonesian and English
- [ ] Phase summary; `PROGRESS.md` updated

**Abuse cases**
- An automated accessibility scan reported as a screen-reader walk
