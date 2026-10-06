# syntax=docker/dockerfile:1
# =============================================================================
# The backup verifier image (U-05, ADR-116): the scheduled infrastructure dump
# and its restore verification — deploy/backup/backup-verify.sh.
#
# Two things in one image, on purpose:
#   - PostgreSQL 18 + pgvector, the SAME pinned image as the compose database:
#     pg_dump/pg_restore/psql of the server's own major, and a server to start a
#     throwaway copy in. A restore test on a different major or without pgvector
#     proves nothing about the restore you will actually run.
#   - the backend's compiled binary, copied from the backend image of the SAME
#     release, for its `verify-schema` (the boot's [schema-verify]) and
#     `backup-alert` (the P7-02 alert path) subcommands. The verifier checks the
#     restored copy with the application's own schema check, not a second one.
#
# BUILD — the backend image is a named build context, `backend-image`:
#   compose:  supplied by additional_contexts (service:backend) — `docker compose build`
#   by hand:  docker build -f deploy/backup/Dockerfile \
#               --build-context backend-image=docker-image://callibrator/backend:<tag> \
#               -t callibrator/backup-verify:<tag> .
# Tag it with the backend's tag: the binary inside must match the schema it checks.
# =============================================================================
FROM backend-image AS app

# P7-07: digest-pinned, the same digest as the compose `postgres` service. Move both together.
FROM pgvector/pgvector:pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a

COPY --from=app /app/backend /opt/callibrator/backend
COPY --from=app /app/src/templates /opt/callibrator/src/templates
COPY deploy/backup/backup-verify.sh /usr/local/bin/backup-verify

# The dump directory and the scratch server's parent, owned by the postgres user (uid 999).
RUN chmod 0755 /usr/local/bin/backup-verify /opt/callibrator/backend \
    && mkdir -p /backups /var/lib/postgresql/scratch \
    && chown postgres:postgres /backups /var/lib/postgresql/scratch

ENV BACKUP_DIR=/backups \
    SCRATCH_DIR=/var/lib/postgresql/scratch \
    CALLIBRATOR_BIN=/opt/callibrator/backend

USER postgres
WORKDIR /var/lib/postgresql
ENTRYPOINT ["/usr/local/bin/backup-verify"]
CMD ["schedule"]
