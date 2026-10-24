# P29-01: the Indonesian user guides, written against the built screens

**Date:** 2026-10-23 · **Card:** P29-01 · **Status:** DONE in code (docs only) · **Spec refs:** `docs/UPSTREAM/02` F-55, F-56 · UD-6 · `docs/UPSTREAM/11-WHAT-CHANGED-ID.md` · `docs/UPSTREAM/12-UAT-PLAN-ID.md` · the deviation protocol

## Hook

P29-01 was marked BLOCKED on **Phase 22** — and Phase 22 is DONE, so the block was stale. The guides
are now written **from the dictionary the screens actually render** (`frontend/src/i18n/messages/id.ts`),
not from the feature research: every menu name, button and message quoted in them is a string the
application shows today. That is the difference between a guide and a wish, and it is why the card
could only be done after Phase 22 rather than before.

## What was built

| | |
|---|---|
| [`docs/UPSTREAM/13-USER-GUIDES-ID.md`](../../docs/UPSTREAM/13-USER-GUIDES-ID.md) (new) | Four guides in Indonesian — **provider technician** (§ 1), **facility user** (§ 2), **provider administrator** (§ 3), **IPSRS countersignature** (§ 4) — plus the three rules common to everyone (§ 0) and a screen-terms glossary (§ 5). Each guide ends with what the role **cannot** do and why |

Grounded, not paraphrased. The screen vocabulary comes from `id.ts`: `Pindai kode QR`,
`Periksa dan kirim`, `Foto bukti` / `Tambah foto bukti`, `Antrean`, `Siapkan ponsel ini`,
`Catat tanggal`, `Fasilitas klien`, `Undang {nama}`, `Tanda tangan bersama`. Where the dashboard and
the field app differ (the field app saves locally and queues; the dashboard autosaves per pause), the
guides say so, because that difference is the thing a technician gets wrong.

## Why

The card names the audiences and the content: technician (capture, offline, corrections), facility
users (what a bound account sees, reports), provider admin (client facilities, binding users), IPSRS
(countersignature). All four are now built and tested, so all four could be written.

## Alternatives considered

- **One guide, all roles.** Rejected: a facility user and a provider technician share almost no
  screens, and a guide that covers both makes each reader skip most of it. The card named the
  audiences separately, which is also how the UAT plan (`12-UAT-PLAN-ID.md`) is organised — one
  persona per script.
- **Writing it before Phase 22, from the feature research.** Rejected for the reason in the Hook: it
  would have described the intended screens. `docs/` is as-built and names its sources; a guide that
  quotes a button that does not exist is the drift this repository has already paid for once.
- **Reusing `11-WHAT-CHANGED-ID.md`.** Kept as the separate "what changed" note it is, and linked at
  the top: it answers *what is different from SKP IPM*, which is a different question from *how do I
  record an IPM*. Both are needed; neither replaces the other.

## What surprised me

Writing against the dictionary found three things a "how to" written from memory would have got
wrong, and each is now stated correctly:

- The field app's setting is called **"Siapkan ponsel ini"**, and the 72-hour purge is on the screen
  ("dihapus dalam {hours} jam kecuali disinkronkan") — not an internal rule to be described.
- **iOS does not sync in the background**; the app says so itself ("Buka aplikasi saat daring untuk
  menyinkronkan (iOS tidak menyinkronkan di latar belakang)"). A guide that omitted this would send
  a technician home with an un-sent queue.
- The IPM interval's screen name is **"Pengaturan IPM dan halaman publik"**, on the **tenant** card
  (M-18), not a page of its own — the guide points there rather than at a route.

A fourth, smaller: the calibration quick entry says a **second entry on the same day is accepted**
with a notice. That is the opposite of the upstream "re-saving overwrites", and it is exactly the
kind of rule a returning user will disbelieve unless the guide says it plainly.

## Tests

Docs only; there is no code to test. What replaces a test here is traceability, per
`docs/UPSTREAM/README` and the Documentation Writer rules:

- every quoted screen string is present in `frontend/src/i18n/messages/id.ts` (checked by
  `findstr` while writing, screen by screen);
- every capability described is a built card: IPM capture and evidence photos (P22-03, C-2),
  corrections and void (P22-04, P21-04), the field app (P22-10), calibration dates (P22-05),
  exports (P22-06), client facilities and binding (P22-09), invitations (P24-09a … d), the move
  (P21-09d), tenant settings (M-18), the report and the countersignature (P23-02, P21-04),
  the public page (P22-08);
- the guides **state their own limits** (§ 6): not run with real users (P26-02), no videos (P29-03),
  four steps depend on settings that are off by default.

- **Not run:** nothing to run. No code, route, migration or test changed.

## Definition of Done

- [x] the four audiences the card names each have a guide, in Indonesian
- [x] written against the built screens (`id.ts`), not the feature research
- [x] each guide names what the role cannot do, and why
- [x] the limits of the document are stated in the document
- [ ] run with real users — **P26-02**, blocked on P25-04; this card does not claim it
- [x] no real data value in the file (synthetic examples only, and no example values at all)

## Files

- `docs/UPSTREAM/13-USER-GUIDES-ID.md` (new)
- `TASKS/PHASE-29-UPSTREAM-TRAINING-DOCS.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`,
  `MEMORY/CHANGELOG.md`, this record
