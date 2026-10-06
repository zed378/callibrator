#!/usr/bin/env bash
# =============================================================================
# backup-verify — the scheduled infrastructure dump AND its restore verification
# (U-05, ADR-116). "Backups are good" was assumed; this makes it known, nightly.
#
#   backup-verify run-once        dump, then verify that dump (the Helm CronJob)
#   backup-verify schedule        run-once every day at BACKUP_AT (the compose service)
#   backup-verify dump            take a dump only
#   backup-verify verify [FILE]   verify FILE, or the newest dump
#
# DUMP. `pg_dump -Fc` of the live database, taken inside an EXPORTED SNAPSHOT:
# the same REPEATABLE READ transaction that pg_dump reads also records the
# source facts — exact row counts of the key tables, a checksum over the
# append-only audit trail, the migration count and the pgvector version — in
# `<dump>.manifest.json` beside the dump, with its SHA-256. Because both read
# one snapshot, the restored copy must match them EXACTLY; no tolerance hides
# a lost row.
#
# VERIFY. Into a THROWAWAY PostgreSQL 18 + pgvector server started inside this
# container (initdb in SCRATCH_DIR, loopback only, deleted afterwards):
#   sha256       the dump is the file the manifest describes (bit rot, truncation)
#   toc          pg_restore can read its table of contents
#   restore      the documented order (docs/DEVOPS/04 § Restore Order): the
#                application role first, then pg_restore --no-owner --exit-on-error
#   pgvector     the `vector` extension exists in the restored database
#   facts        row counts, audit checksum, migrations, pgvector version = source
#   schema       the APPLICATION's schema check (`backend verify-schema`, the
#                boot's [schema-verify]) against the restored database
# The time from restore start to the last check is recorded as restoreSeconds:
# the database part of a measured RTO.
#
# OUTCOME. Every run writes BACKUP_DIR/last-restore-verify.json (and appends to
# restore-verify.history.jsonl), then runs `backend backup-alert` on it: a
# failure is a critical alert through the application's own alert path (log
# line + ALERT_WEBHOOK_URL + ALERT_EMAIL_TO). The backend's job watchdog also
# reads the file (RESTORE_VERIFY_STATUS_FILE) and alerts when it goes stale.
#
# SECRETS. The source password reaches pg_dump/psql through PGPASSWORD only,
# never argv, and is never printed. The scratch server trusts loopback inside
# this container and holds no password. The application check runs with
# THROWAWAY random secrets: it reads the schema, it never decrypts anything,
# so the real JWT/KMS/certificate secrets never enter this container.
# =============================================================================
set -Eeuo pipefail
umask 077
# A write to a psql that has exited must fail the write, not kill this script.
trap '' PIPE

: "${DB_HOST:?DB_HOST is required}"
: "${DB_NAME:?DB_NAME is required}"
: "${DB_USER:?DB_USER is required}"
DB_PORT="${DB_PORT:-5432}"
DB_APP_ROLE="${DB_APP_ROLE:-callibrator_app}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
BACKUP_AT="${BACKUP_AT:-02:30}"
BACKUP_RUN_ON_START="${BACKUP_RUN_ON_START:-0}"
BACKUP_VERIFY_TABLES="${BACKUP_VERIFY_TABLES:-tenants users calibration_devices calibration_records certificates attachments audit_logs tenant_keys schema_migrations}"
CALLIBRATOR_BIN="${CALLIBRATOR_BIN:-/opt/callibrator/backend}"
SCRATCH_DIR="${SCRATCH_DIR:-/var/lib/postgresql/scratch}"
SCRATCH_PORT="${SCRATCH_PORT:-54329}"

STATUS_FILE="${BACKUP_DIR}/last-restore-verify.json"
HISTORY_FILE="${BACKUP_DIR}/restore-verify.history.jsonl"

# The source connection: the password is in the environment, never on a command line.
export PGPASSWORD="${DB_PASS:-}"
SRC=(-h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME")

log() { printf '%s backup-verify: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
now_s() { date +%s; }
# 32 random bytes as hex: a throwaway secret for the application binary's load-time checks.
rnd() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }

# JSON string literal (or null for an empty value).
json_str() {
  if [ -z "${1-}" ]; then printf 'null'; return; fi
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/}
  s=${s//$'\t'/ }
  # Drop any other control character.
  s=$(printf '%s' "$s" | tr -d '\000-\010\013\014\016-\037')
  printf '"%s"' "$s"
}

# The last meaningful line of a log file, bounded — the error carried into the outcome.
last_error() {
  local f=$1
  [ -s "$f" ] || { printf 'no output'; return; }
  grep -v '^[[:space:]]*$' "$f" | tail -n 1 | cut -c1-400
}

# Table names are interpolated into SQL, so only plain identifiers are accepted.
validate_tables() {
  local t
  for t in $BACKUP_VERIFY_TABLES; do
    [[ $t =~ ^[a-z_][a-z0-9_]*$ ]] || { log "refusing table name '$t' in BACKUP_VERIFY_TABLES"; exit 2; }
  done
}

# One line of JSON: the facts a restored copy must reproduce exactly.
facts_sql() {
  local t counts=""
  for t in $BACKUP_VERIFY_TABLES; do
    counts+="'$t', (SELECT CASE WHEN to_regclass('public.$t') IS NULL THEN NULL ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.$t', false, true, '')))[1]::text::bigint END),"
  done
  counts=${counts%,}
  cat <<SQL
SELECT json_build_object(
  'counts', json_build_object($counts),
  'auditChecksum', (SELECT CASE WHEN to_regclass('public.audit_logs') IS NULL THEN NULL ELSE
      (xpath('/row/c/text()', query_to_xml('SELECT coalesce(sum(hashtextextended(id::text || ''|'' || extract(epoch FROM created_at)::text, 0)::numeric), 0) AS c FROM public.audit_logs', false, true, '')))[1]::text END),
  'migrations', (SELECT CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN NULL ELSE
      (xpath('/row/c/text()', query_to_xml('SELECT count(*) || '':'' || coalesce(max(name), '''') AS c FROM public.schema_migrations', false, true, '')))[1]::text END),
  'vector', (SELECT extversion FROM pg_extension WHERE extname = 'vector')
)::text;
SQL
}

# ----------------------------------------------------------------------------
# DUMP
# ----------------------------------------------------------------------------
DUMP_FILE=""
DUMP_ERROR=""

do_dump() {
  mkdir -p "$BACKUP_DIR"
  local ts base work snapshot facts started finished sha bytes
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  base="db-${ts}"
  work=$(mktemp -d)
  started=$(now_iso)
  log "dump: starting ${base}.dump from ${DB_HOST}:${DB_PORT}/${DB_NAME}"

  # Hold one REPEATABLE READ transaction open: export its snapshot to pg_dump and
  # read the source facts inside it.
  coproc SNAP { psql -X "${SRC[@]}" -q -A -t -v ON_ERROR_STOP=1 2>"$work/snap.err"; }
  local snap_in=${SNAP[1]:-} snap_out=${SNAP[0]:-} snap_pid=${SNAP_PID:-}
  if [ -z "$snap_in" ] || [ -z "$snap_out" ]; then
    DUMP_ERROR="could not connect to the source: $(last_error "$work/snap.err")"
    rm -rf "$work"
    return 1
  fi
  printf '%s\n' "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;" "SELECT pg_export_snapshot();" 1>&"$snap_in" 2>/dev/null || true
  if ! read -r -t 60 snapshot <&"$snap_out" || [ -z "$snapshot" ]; then
    DUMP_ERROR="could not open a snapshot on the source: $(last_error "$work/snap.err")"
    kill "$snap_pid" 2>/dev/null || true
    rm -rf "$work"
    return 1
  fi
  { facts_sql | tr '\n' ' '; printf '\n'; } 1>&"$snap_in" 2>/dev/null || true
  if ! read -r -t 1800 facts <&"$snap_out" || [ -z "$facts" ]; then
    DUMP_ERROR="could not read the source facts: $(last_error "$work/snap.err")"
    kill "$snap_pid" 2>/dev/null || true
    rm -rf "$work"
    return 1
  fi

  if ! pg_dump "${SRC[@]}" -Fc --snapshot="$snapshot" -f "${BACKUP_DIR}/${base}.dump.partial" 2>"$work/dump.err"; then
    DUMP_ERROR="pg_dump failed: $(last_error "$work/dump.err")"
    kill "$snap_pid" 2>/dev/null || true
    rm -f "${BACKUP_DIR}/${base}.dump.partial"
    rm -rf "$work"
    return 1
  fi
  printf 'COMMIT;\n\\q\n' 1>&"$snap_in" 2>/dev/null || true
  wait "$snap_pid" 2>/dev/null || true

  mv "${BACKUP_DIR}/${base}.dump.partial" "${BACKUP_DIR}/${base}.dump"
  finished=$(now_iso)
  sha=$(sha256sum "${BACKUP_DIR}/${base}.dump" | cut -d' ' -f1)
  bytes=$(stat -c %s "${BACKUP_DIR}/${base}.dump")
  printf '{"version":1,"dumpFile":%s,"sha256":%s,"bytes":%s,"startedAt":%s,"finishedAt":%s,"source":%s,"facts":%s}\n' \
    "$(json_str "${base}.dump")" "$(json_str "$sha")" "$bytes" "$(json_str "$started")" "$(json_str "$finished")" \
    "$(json_str "${DB_HOST}:${DB_PORT}/${DB_NAME}")" "$facts" >"${BACKUP_DIR}/${base}.manifest.json.partial"
  mv "${BACKUP_DIR}/${base}.manifest.json.partial" "${BACKUP_DIR}/${base}.manifest.json"
  rm -rf "$work"
  DUMP_FILE="${BACKUP_DIR}/${base}.dump"
  log "dump: ${base}.dump written (${bytes} bytes, sha256 ${sha:0:12}…)"
}

# ----------------------------------------------------------------------------
# VERIFY
# ----------------------------------------------------------------------------
CHECKS=()
VERIFY_ERROR=""
RESTORE_SECONDS=""
SCRATCH_PID_DIR=""

check() { # name ok detail
  CHECKS+=("{\"name\":$(json_str "$1"),\"ok\":$2,\"detail\":$(json_str "${3-}")}")
  if [ "$2" = true ]; then log "verify: ${1} ok${3:+ — $3}"; else log "verify: ${1} FAILED${3:+ — $3}"; fi
}

scratch_psql() { psql -X -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$SCRATCH_PORT" -U "$DB_USER" "$@"; }

stop_scratch() {
  if [ -n "$SCRATCH_PID_DIR" ] && [ -f "$SCRATCH_PID_DIR/data/postmaster.pid" ]; then
    pg_ctl -D "$SCRATCH_PID_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  if [ -n "$SCRATCH_PID_DIR" ]; then rm -rf "$SCRATCH_PID_DIR"; fi
  SCRATCH_PID_DIR=""
}

# Verify one dump; returns non-zero on the first failed check.
do_verify() {
  local dump=$1 manifest want_sha got_sha src_facts rest_facts diff t0 out
  manifest="${dump%.dump}.manifest.json"
  CHECKS=()
  VERIFY_ERROR=""
  RESTORE_SECONDS=""

  if [ ! -f "$dump" ] || [ ! -f "$manifest" ]; then
    VERIFY_ERROR="dump or manifest missing: $(basename "$dump")"
    check manifest false "$VERIFY_ERROR"
    return 1
  fi
  want_sha=$(sed -n 's/.*"sha256":"\([0-9a-f]*\)".*/\1/p' "$manifest")
  src_facts=$(sed -n 's/.*"facts":\(.*\)}$/\1/p' "$manifest")
  got_sha=$(sha256sum "$dump" | cut -d' ' -f1)
  if [ -z "$want_sha" ] || [ "$want_sha" != "$got_sha" ]; then
    VERIFY_ERROR="sha256 mismatch: the dump is not the file its manifest describes (truncated or corrupted)"
    check sha256 false "manifest ${want_sha:0:12}…, file ${got_sha:0:12}…"
    return 1
  fi
  check sha256 true "${got_sha:0:12}…"

  if ! out=$(pg_restore --list "$dump" 2>&1 >/dev/null); then
    VERIFY_ERROR="pg_restore cannot read the archive: $(printf '%s' "$out" | tail -n 1 | cut -c1-300)"
    check toc false "$VERIFY_ERROR"
    return 1
  fi
  check toc true "$(pg_restore --list "$dump" | grep -c '^[0-9]') entries"

  # A throwaway PostgreSQL 18: loopback only, trust inside this container, deleted afterwards.
  mkdir -p "$SCRATCH_DIR"
  SCRATCH_PID_DIR=$(mktemp -d "$SCRATCH_DIR/run.XXXXXX")
  t0=$(now_s)
  if ! initdb -D "$SCRATCH_PID_DIR/data" -U "$DB_USER" --auth=trust -E UTF8 --locale=C.UTF-8 >"$SCRATCH_PID_DIR/initdb.log" 2>&1; then
    VERIFY_ERROR="initdb failed: $(last_error "$SCRATCH_PID_DIR/initdb.log")"
    check scratch false "$VERIFY_ERROR"
    return 1
  fi
  mkdir -p "$SCRATCH_PID_DIR/sock"
  if ! pg_ctl -D "$SCRATCH_PID_DIR/data" -w -t 120 -l "$SCRATCH_PID_DIR/server.log" \
      -o "-c listen_addresses=127.0.0.1 -p $SCRATCH_PORT -c unix_socket_directories=$SCRATCH_PID_DIR/sock" start >/dev/null 2>&1; then
    VERIFY_ERROR="the scratch server did not start: $(last_error "$SCRATCH_PID_DIR/server.log")"
    check scratch false "$VERIFY_ERROR"
    return 1
  fi
  check scratch true "PostgreSQL $(scratch_psql -d postgres -c 'SHOW server_version' | cut -d' ' -f1) on 127.0.0.1:${SCRATCH_PORT}"

  # Restore in the documented order: the application role first (it is cluster-wide and
  # not in a dump), then the archive, stopping at the first error.
  {
    if [ "$DB_APP_ROLE" != "none" ]; then
      printf 'CREATE ROLE %s NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;\n' "\"$DB_APP_ROLE\""
    fi
    printf 'CREATE DATABASE %s OWNER %s;\n' "\"$DB_NAME\"" "\"$DB_USER\""
  } | scratch_psql -d postgres >"$SCRATCH_PID_DIR/roles.log" 2>&1 || {
    VERIFY_ERROR="could not prepare the scratch database: $(last_error "$SCRATCH_PID_DIR/roles.log")"
    check restore false "$VERIFY_ERROR"
    return 1
  }
  if ! pg_restore -h 127.0.0.1 -p "$SCRATCH_PORT" -U "$DB_USER" -d "$DB_NAME" --no-owner --exit-on-error "$dump" \
      >"$SCRATCH_PID_DIR/restore.log" 2>&1; then
    VERIFY_ERROR="pg_restore failed: $(last_error "$SCRATCH_PID_DIR/restore.log")"
    check restore false "$VERIFY_ERROR"
    return 1
  fi
  check restore true "pg_restore --exit-on-error exit 0 in $(( $(now_s) - t0 )) s"

  local vec
  vec=$(scratch_psql -d "$DB_NAME" -c "SELECT extversion FROM pg_extension WHERE extname = 'vector'")
  if [ -z "$vec" ]; then
    VERIFY_ERROR="the vector extension is missing from the restored database"
    check pgvector false "$VERIFY_ERROR"
    return 1
  fi
  check pgvector true "vector ${vec}"

  # Fail closed: this function runs under `if`, where `set -e` does not apply, so an
  # empty or failed read must be a failed check, never a silent pass.
  if [ -z "$src_facts" ]; then
    VERIFY_ERROR="the manifest records no source facts"
    check facts false "$VERIFY_ERROR"
    return 1
  fi
  if ! rest_facts=$(facts_sql | scratch_psql -d "$DB_NAME" 2>"$SCRATCH_PID_DIR/facts.err") || [ -z "$rest_facts" ]; then
    VERIFY_ERROR="could not read the restored facts: $(last_error "$SCRATCH_PID_DIR/facts.err")"
    check facts false "$VERIFY_ERROR"
    return 1
  fi
  if ! diff=$(scratch_psql -d "$DB_NAME" -v src="$src_facts" -v rest="$rest_facts" 2>"$SCRATCH_PID_DIR/facts.err" <<'SQL'
WITH s AS (SELECT :'src'::jsonb AS j), r AS (SELECT :'rest'::jsonb AS j),
pairs AS (
  SELECT 'count:' || k AS what, (SELECT j->'counts'->>k FROM s) AS source, (SELECT j->'counts'->>k FROM r) AS restored
    FROM (SELECT jsonb_object_keys(j->'counts') AS k FROM s UNION SELECT jsonb_object_keys(j->'counts') FROM r) keys
  UNION ALL SELECT 'auditChecksum', (SELECT j->>'auditChecksum' FROM s), (SELECT j->>'auditChecksum' FROM r)
  UNION ALL SELECT 'migrations', (SELECT j->>'migrations' FROM s), (SELECT j->>'migrations' FROM r)
  UNION ALL SELECT 'vector', (SELECT j->>'vector' FROM s), (SELECT j->>'vector' FROM r)
)
SELECT string_agg(what || ' source=' || coalesce(source, 'null') || ' restored=' || coalesce(restored, 'null'), '; ' ORDER BY what)
  FROM pairs WHERE source IS DISTINCT FROM restored;
SQL
  ); then
    VERIFY_ERROR="could not compare the facts: $(last_error "$SCRATCH_PID_DIR/facts.err")"
    check facts false "$VERIFY_ERROR"
    return 1
  fi
  if [ -n "$diff" ]; then
    VERIFY_ERROR="the restored copy differs from the source snapshot: ${diff:0:400}"
    check facts false "$diff"
    return 1
  fi
  check facts true "$(printf '%s' "$rest_facts" | sed -n 's/.*"counts" *: *\({[^}]*}\).*/\1/p' | tr -d ' ' | cut -c1-300)"

  # The application's own schema check, as the boot runs it. Throwaway secrets: it
  # validates them at load and never uses them.
  mkdir -p "$SCRATCH_PID_DIR/app"
  if [ ! -x "$CALLIBRATOR_BIN" ]; then
    VERIFY_ERROR="the application binary is missing at ${CALLIBRATOR_BIN}: the schema check cannot run"
    check schema false "$VERIFY_ERROR"
    return 1
  fi
  if ! (cd "$(dirname "$CALLIBRATOR_BIN")" && env -i PATH="$PATH" HOME="$SCRATCH_PID_DIR/app" TZ="${TZ:-UTC}" \
      NODE_ENV=production APP_STORAGE_PATH="$SCRATCH_PID_DIR/app" LOG_LEVEL=warn \
      DB_HOST=127.0.0.1 DB_PORT="$SCRATCH_PORT" DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASS=scratch-trust \
      JWT_ACCESS_SECRET="$(rnd)" JWT_REFRESH_SECRET="$(rnd)" CERT_SIGNING_SECRET="$(rnd)" \
      KMS_MASTER_KEY="$(rnd)" ACCESS_REQUEST_IP_PEPPER="$(rnd)" \
      "$CALLIBRATOR_BIN" verify-schema >"$SCRATCH_PID_DIR/schema.log" 2>&1) \
      || ! grep -q '\[schema-verify\] OK' "$SCRATCH_PID_DIR/schema.log"; then
    VERIFY_ERROR="the application's schema check failed on the restored copy: $(grep -E '\[schema-verify\]' "$SCRATCH_PID_DIR/schema.log" | tail -n 1 | cut -c1-300)"
    [ "$VERIFY_ERROR" != "the application's schema check failed on the restored copy: " ] || VERIFY_ERROR+=$(last_error "$SCRATCH_PID_DIR/schema.log")
    check schema false "$VERIFY_ERROR"
    return 1
  fi
  check schema true "$(grep -E '\[schema-verify\] OK' "$SCRATCH_PID_DIR/schema.log" | tail -n 1 | sed 's/.*\[schema-verify\] //' | cut -c1-200)"
  RESTORE_SECONDS=$(( $(now_s) - t0 ))
}

# ----------------------------------------------------------------------------
# OUTCOME
# ----------------------------------------------------------------------------
write_outcome() { # ok phase started started_s dump_file error
  local ok=$1 phase=$2 started=$3 started_s=$4 dump=$5 error=$6 finished age="" checks
  finished=$(now_iso)
  if [ -n "$dump" ] && [ -f "${dump%.dump}.manifest.json" ]; then
    local dumped
    dumped=$(sed -n 's/.*"finishedAt":"\([^"]*\)".*/\1/p' "${dump%.dump}.manifest.json")
    [ -z "$dumped" ] || age=$(( $(now_s) - $(date -d "$dumped" +%s) ))
  fi
  checks=$(IFS=,; printf '%s' "${CHECKS[*]-}")
  mkdir -p "$BACKUP_DIR"
  printf '{"version":1,"ok":%s,"phase":%s,"startedAt":%s,"finishedAt":%s,"dumpFile":%s,"dumpAgeSeconds":%s,"restoreSeconds":%s,"totalSeconds":%s,"checks":[%s],"error":%s,"host":%s}\n' \
    "$ok" "$(json_str "$phase")" "$(json_str "$started")" "$(json_str "$finished")" "$(json_str "$(basename "${dump:-}")")" \
    "${age:-null}" "${RESTORE_SECONDS:-null}" "$(( $(now_s) - started_s ))" "$checks" "$(json_str "$error")" \
    "$(json_str "$(hostname)")" >"${STATUS_FILE}.partial"
  chmod 0644 "${STATUS_FILE}.partial"
  mv "${STATUS_FILE}.partial" "$STATUS_FILE"
  cat "$STATUS_FILE" >>"$HISTORY_FILE"
  chmod 0644 "$HISTORY_FILE" 2>/dev/null || true
  if [ "$ok" = true ] && [ -n "$dump" ]; then cp "$STATUS_FILE" "${dump%.dump}.verified.json"; fi
  log "outcome: ok=${ok} phase=${phase} dump=$(basename "${dump:-none}") restoreSeconds=${RESTORE_SECONDS:-n/a} → ${STATUS_FILE}"
  # The application's alert path. A pass raises nothing; a failure is a critical alert.
  if [ -x "$CALLIBRATOR_BIN" ]; then
    (cd "$(dirname "$CALLIBRATOR_BIN")" && env -i PATH="$PATH" HOME=/tmp TZ="${TZ:-UTC}" NODE_ENV=production \
      APP_STORAGE_PATH="$(mktemp -d)" LOG_LEVEL=info \
      DB_HOST=127.0.0.1 DB_PORT=1 DB_NAME=none DB_USER=none DB_PASS=none \
      JWT_ACCESS_SECRET="$(rnd)" JWT_REFRESH_SECRET="$(rnd)" CERT_SIGNING_SECRET="$(rnd)" \
      KMS_MASTER_KEY="$(rnd)" ACCESS_REQUEST_IP_PEPPER="$(rnd)" \
      ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}" ALERT_EMAIL_TO="${ALERT_EMAIL_TO:-}" \
      ALERT_WEBHOOK_TIMEOUT_MS="${ALERT_WEBHOOK_TIMEOUT_MS:-}" \
      MAIL_HOST="${MAIL_HOST:-}" MAIL_PORT="${MAIL_PORT:-}" MAIL_USER="${MAIL_USER:-}" \
      MAIL_PASSWORD="${MAIL_PASSWORD:-}" MAIL_FROM="${MAIL_FROM:-}" \
      "$CALLIBRATOR_BIN" backup-alert "$STATUS_FILE" 2>&1 | grep -E 'ALERT|backup-alert|Alert sink' || true)
  else
    log "ALERT PATH UNAVAILABLE: ${CALLIBRATOR_BIN} missing — the outcome is only in ${STATUS_FILE} and this log"
  fi
}

# Keep the newest BACKUP_KEEP dumps, and always the newest VERIFIED one.
newest_first() { # every dump in BACKUP_DIR, newest first (names sort by their UTC timestamp)
  local f
  for f in "$BACKUP_DIR"/db-*.dump; do if [ -e "$f" ]; then printf '%s\n' "$f"; fi; done | sort -r
}

prune() {
  local keep=$BACKUP_KEEP newest_verified="" i=0 f dumps=()
  [[ $keep =~ ^[1-9][0-9]*$ ]] || keep=14
  mapfile -t dumps < <(newest_first)
  for f in "${dumps[@]}"; do
    if [ -f "${f%.dump}.verified.json" ]; then newest_verified=$f; break; fi
  done
  for f in "${dumps[@]}"; do
    i=$((i + 1))
    if [ "$i" -le "$keep" ] || [ "$f" = "$newest_verified" ]; then continue; fi
    rm -f "$f" "${f%.dump}.manifest.json" "${f%.dump}.verified.json"
    log "prune: removed $(basename "$f")"
  done
}

run_once() {
  local started started_s rc=0
  started=$(now_iso)
  started_s=$(now_s)
  CHECKS=()
  RESTORE_SECONDS=""
  if ! do_dump; then
    log "dump FAILED: ${DUMP_ERROR}"
    write_outcome false dump "$started" "$started_s" "" "$DUMP_ERROR"
    return 1
  fi
  if do_verify "$DUMP_FILE"; then
    stop_scratch
    write_outcome true complete "$started" "$started_s" "$DUMP_FILE" ""
  else
    stop_scratch
    write_outcome false verify "$started" "$started_s" "$DUMP_FILE" "$VERIFY_ERROR"
    rc=1
  fi
  prune
  return "$rc"
}

verify_only() {
  local dump=${1-} started started_s
  started=$(now_iso)
  started_s=$(now_s)
  if [ -z "$dump" ]; then
    dump=$(newest_first | head -n 1)
  fi
  if [ -z "$dump" ]; then
    CHECKS=()
    write_outcome false verify "$started" "$started_s" "" "no dump found in ${BACKUP_DIR}"
    return 1
  fi
  if do_verify "$dump"; then
    stop_scratch
    write_outcome true complete "$started" "$started_s" "$dump" ""
  else
    stop_scratch
    write_outcome false verify "$started" "$started_s" "$dump" "$VERIFY_ERROR"
    return 1
  fi
}

seconds_until() { # HH:MM, local time
  local target
  target=$(date -d "today $1" +%s)
  if [ "$target" -le "$(now_s)" ]; then target=$(date -d "tomorrow $1" +%s); fi
  printf '%s' $(( target - $(now_s) ))
}

schedule() {
  if [ "$BACKUP_AT" = "disabled" ] || [ "$BACKUP_AT" = "off" ]; then
    log "schedule DISABLED (BACKUP_AT=${BACKUP_AT}): no dump will be taken; the backend watchdog will report it missed"
    trap 'exit 0' TERM INT
    while true; do sleep 3600 & wait $!; done
  fi
  [[ $BACKUP_AT =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { log "invalid BACKUP_AT '${BACKUP_AT}' (HH:MM expected)"; exit 2; }
  trap 'log "stopping"; stop_scratch; exit 0' TERM INT
  if [ "$BACKUP_RUN_ON_START" = "1" ]; then run_once || true; fi
  while true; do
    local wait_s
    wait_s=$(seconds_until "$BACKUP_AT")
    log "next run at ${BACKUP_AT} (${TZ:-UTC}), in ${wait_s} s"
    sleep "$wait_s" & wait $!
    run_once || true
  done
}

validate_tables
trap 'stop_scratch' EXIT
case "${1:-schedule}" in
  run-once) run_once ;;
  schedule) schedule ;;
  dump) do_dump || { log "dump FAILED: ${DUMP_ERROR}"; exit 1; } ;;
  verify) verify_only "${2-}" ;;
  *) printf 'usage: backup-verify {run-once|schedule|dump|verify [FILE]}\n' >&2; exit 2 ;;
esac
