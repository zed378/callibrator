# Debate C-1: Is a "retired" device permanently retired? (Q-02)

Debate paper · 2026-09-27/28 · decided in **ADR-084** (`../MEMORY/DECISIONS.md`) · format of
[`DEBATE-owner-questions-A-compliance.md`](./DEBATE-owner-questions-A-compliance.md) and
[`DEBATE-owner-questions-B-operability.md`](./DEBATE-owner-questions-B-operability.md), with both positions in one
paper and the referee's decision at the end.

## The behaviour as the code had it (read 2026-09-27)

- `calibration_devices.status` is an ENUM `active | inactive | maintenance | retired`
  (`backend/src/models/calibrationDevice.model.js`).
- `PUT /calibration-devices/:id` validated `status` against all four values and wrote any of them over any other,
  with an ordinary `UPDATE` audit row (`calibrationDevices.service.js#updateCalibrationDevice`). A retired device could
  be set back to `active` by anyone with `calibration: write`, and the trail would show an edit, not a reversal.
- Nothing in the database refused it. Proven on PostgreSQL 18.6: before migration 0089, `UPDATE calibration_devices
  SET status = 'active' WHERE status = 'retired'` succeeds (the first assertion of
  `calibrationDevice.retired.q02.live.test.js`).
- Serial numbers are unique per tenant and **stay reserved on a soft-deleted device** (ADR-078). A-133 (ADR-075) added
  `POST /calibration-devices/:id/restore` for a device **deleted** in error.

## Position A — compliance first: retired is final, in the database

1. ISO 17025 §6.4.9/§6.4.13 and ISO 13485 §7.6 expect equipment taken out of service to be kept out of use and its
   status to be unambiguous. A retirement that an edit can silently undo is not a status; it is a suggestion.
2. The convention has already failed the way conventions fail: the edit path accepts it today.
3. Two layers, as ADR-062 did for calibration records: the service refuses, and a trigger refuses for every role, so
   a script, a future endpoint or a hand-written UPDATE cannot undo a retirement either.
4. If the device was never really retired, register it again. A new register entry is honest about what happened.

**Concedes:** "register it again" collides with ADR-078: the old device keeps its serial, so the physical instrument
cannot be re-registered under its own serial number. A cannot answer that without deleting the old record's
attribution, which it will not accept.

## Position B — operability first: reversible, but on the record

1. Retirements are entered in error: the wrong row in a stock take, the wrong asset tag, a bulk edit. In a hospital
   that is a working analyser vanishing from the calibration schedule (`API/07`: retired devices are excluded from
   the overdue list), which is a patient-safety problem of its own.
2. A state with no way back pushes the correction to the database, i.e. to the most privileged access there is —
   the pattern ADR-043 records as the worst outcome of a lockout.
3. With the serial reserved (ADR-078), "register it again" is impossible for the same instrument. Its calibration
   history would be split across two register entries, which is worse for an assessor than one entry with a
   recorded correction.
4. So: allow leaving `retired`, but only through a distinct act that requires a reason and writes its own audit row.

**Concedes:** if the ordinary edit path stays open, B's "distinct act" is decoration. B accepts that the edit path must
refuse, and that a database backstop costs nothing at runtime.

## Where they agree

- The ordinary edit must not undo a retirement.
- Whatever path exists must be attributable, with a reason, in the same transaction as the change.
- Retiring stays an ordinary edit; editing a retired device's other fields (remarks, location) stays allowed.

## Referee's decision (ADR-084, Q-02)

**Retired is terminal. The one way back is an audited reinstatement — a correction, not an edit.**

| | |
|---|---|
| Edit path | `PUT /:id` with a status other than `retired` on a retired device → **409** with a state explanation naming the reinstatement |
| Database | migration **0089**: trigger `calibration_devices_retired_terminal` (`BEFORE UPDATE OF status`) refuses leaving `retired` for every role, SQLSTATE 23514, unless the transaction has named *that* device in the transaction-local setting `callibrator.reinstate_device`. The edit path maps the trigger's error to the same 409 (the race). In `schemaVerify` EXPECTED_OBJECTS, so a boot without it fails |
| Correction | `POST /calibration-devices/:id/reinstate` — tenant administrator (`rbac TENANT_ADMIN`) with `calibration: write`; body `reason` (10–1000 chars) and `status` (`active`/`inactive`/`maintenance`); status change + `UPDATE` audit row `operation: "REINSTATE"` with the reason, one transaction |
| Cross-tenant | another tenant's device → **404**, identical to a missing one |

**Retire, restore and reinstate are three different acts.** *Retire* is a status: the device exists, keeps its history
and its serial. *Restore* (A-133) undoes a soft **delete** and leaves the status alone — a retired device that is
restored is still retired. *Reinstate* undoes a **retirement**, and refuses a deleted device (404: restore it first).

**Why B's shape with A's enforcement:** A's database rule is kept whole; B's correction path exists because A's own
remedy ("register it again") is impossible under ADR-078 and would split the instrument's history. The trigger's
escape hatch is honest about what it is: it stops an accidental or ordinary-path revival, not a person who can run SQL
and chooses to set the variable — the audit row is what makes the deliberate act visible.

**Left open:** whether a retired device should also refuse *new* calibration records, IoT ingest and work orders.
Today it does not (`calibrationRecords.service` does not read device status). A backdated record for work done before
retirement is legitimate, so the rule needs a retirement date, which the table does not have.
