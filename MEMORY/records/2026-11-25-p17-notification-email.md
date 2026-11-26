# 2026-11-25 — PT-18 notification email boundary

Scope: P17-07 PT-18; no physical-device testing or external email delivery.
Spec refs: `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` § 12 PT-18;
`MEMORY/specs/P19-04-client-facilities.md` § 9.6 (AM-21).

Added `backend/src/tests/services/notificationEmail.facility.p1707.test.ts`.
The test uses the real role seed, model definitions, tenant hooks and recipient
selector over `memoryDb`, then the real notification, channel and HTML services.
The queue is replaced with an in-process call to the real email renderer;
nodemailer's transport captures messages without network delivery.

Named verification: `notificationEmail.facility.p1707`, **3/3 passed**, focused
Jest run with coverage disabled:

- The real calibration scan processes two overdue devices and creates their
  reminders without sending email. `calibrationScheduler.service.ts` supplies
  no email channel; `notificationChannels.service.ts` defaults to realtime only.
- Explicitly opting addressed notifications into email selects only each row's
  facility recipients. F1/F2 captured HTML contains its own device and serial,
  excludes the other's, and escapes an injected HTML device name. A second
  tenant's user is excluded even with a matching facility ID. Delivery waits
  until the notification transaction commits.
- Rolling back the notification transaction sends no email.

Focused ESLint on the new test: exit 0. Scoped `git diff --check`: exit 0
(both files are new/untracked, so the latter does not substitute for lint).
Integration replaced the queue stub's loose record cast with the actual email
input type after TS2352. Full backend TypeScript 7 typecheck then passed; the
named three-test suite was repeated successfully after this change.

No product mail behavior changed. The initial test drafts failed due to fixture
initialization order and an incorrect import for `runForTenant`; both were
corrected before the green run. No application isolation defect was observed.

Limitations: `memoryDb` is not PostgreSQL. RabbitMQ serialization, worker
delivery, SMTP and received MIME bodies are not exercised. The opt-in test does
not assert that the reminder job enables email: it does not. This strengthens
the application regression evidence but does not close PT-18's full live email
case or the P17-07 exit gate. No full coverage/full verification claim.
