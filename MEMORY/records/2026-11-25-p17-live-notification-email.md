# 2026-11-25 — PT-18 live notification email transport

Status: implemented and verified in the working tree; no P17 exit or merge claimed.
Spec refs: `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` §12 PT-18;
`MEMORY/specs/P19-04-client-facilities.md` §9.6 (recipient routing).

`backend/src/tests/services/notificationEmail.facility.p1707.live.test.ts`
uses real PostgreSQL schema/migrations and switches to `callibrator_app` with
`fixtures/liveBoot.ts`. Its two synthetic bound technicians belong to different
facilities. The real `notificationRecipients.recipientsFor` independently selects
each expected user. That returned user id is passed to the real transactional
`notification.service.emitNotification`, `notificationChannels.service`,
`emailQueue.service` producer/consumer and `email.service` SMTP transport.
There are no Jest mocks in this suite.

Before starting the consumer, the test waits for exactly two RabbitMQ jobs and
requires zero matching Mailpit messages. This distinguishes real broker delivery
from the producer's direct-SMTP fallback. It then starts the real consumer and
checks actual delivered HTML, exactly one intended To recipient, no Cc/Bcc,
own-facility serial/name canaries, absence of the other facility's canaries and
HTML escaping. The rollback test first stops consumers, so a zero queue count
cannot mean an incorrectly published job was already consumed.

A third test inserts two overdue devices and executes the real
`calibrationScheduler.runCalibrationScan`. It creates two work orders and reports
two notifications with zero errors, while the stopped-consumer queue remains
empty. This preserves and verifies the existing realtime-only reminder policy;
it does not invent an opt-in email reminder setting.

## Named evidence

Command: `npm --prefix backend run test:live -- --only=p1707email --with=rabbitmq`
with disposable PostgreSQL connection variables, `RABBITMQ_LIVE_URL`,
`RABBITMQ_LIVE_CONTAINER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM` and
`E2E_MAILPIT_URL` set in the temporary local runner environment.

- `notificationEmail.facility.p1707.live` — **3/3 passed**, 55.288 seconds Jest;
  the preceding transport-only version passed **2/2**, 94.091 seconds.
- Backend `npm run typecheck` — exit 0 after the initial live suite was added.
  Later additions still need the final aggregate typecheck.
- Focused ESLint on the final three-case file — exit 0 (zero errors/warnings).

The first run found a fixture error: the database correctly refused a direct
facility-binding UPDATE. Fixture setup now uses the actual binding operation's
transaction-local user-id setting. A later attempt observed an asynchronous
broker publish before it had arrived; bounded readiness polling retains the
exact two-job assertion. Neither was a product security finding.

## Scope and limitations

The test starts the real worker function inside Jest, not the packaged backend
process. RabbitMQ and SMTP/Mailpit are separate real disposable containers,
bound only to local ports 55476/55477/55478; the scratch database is on the
existing disposable PostgreSQL at port 55474. Setup purges only the dedicated
email queue; the Mailpit query filters by a fresh run id without deleting mail.
The runner drops its scratch database after the run.

Redis deduplication was unavailable during delivery and logged its documented
fallback; this evidence does not claim deduplication or retry reliability.
Socket.IO was not initialized in this service test; existing live HTTP/socket
evidence remains separate. This is a real email channel/body/recipient proof,
not a claim that calibration reminders now send email, nor a full P17-07 exit.
No production data, deployment or owner signoff was involved.
