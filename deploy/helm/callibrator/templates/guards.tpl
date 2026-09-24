{{/*
Render-time guards.

These fail `helm template` rather than the cluster. A configuration that would
silently misbehave in production should not render at all — a deployment
failure is loud, and a double-running scheduler is not.

See docs/DEVOPS/09-KUBERNETES.md.
*/}}

{{/* ---------------------------------------------------------------------- */}}
{{/* Guard 1 — an image tag is required.                                     */}}
{{/*                                                                         */}}
{{/* `:latest` in a cluster means nobody can say what is running, and a       */}}
{{/* rollback has nothing to roll back to.                                   */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guard.imageTag" -}}
{{- if and .Values.backend.enabled (not .Values.backend.image.tag) -}}
{{- fail "\n\nbackend.image.tag is required.\n\nRefusing to render without an explicit tag: `:latest` in a cluster means\nnobody can say what is running, and a rollback has nothing to roll back to.\n\nSet it with: --set backend.image.tag=<sha-or-version>\n" -}}
{{- end -}}
{{- if and .Values.frontend.enabled (not .Values.frontend.image.tag) -}}
{{- fail "\n\nfrontend.image.tag is required.\n\nSee the note on backend.image.tag. Note also that NEXT_PUBLIC_* values are\ninlined at build time, so a different API URL or a tenant-pinned build is a\ndifferent image — this chart cannot configure them at runtime.\n" -}}
{{- end -}}
{{- end -}}

{{/* ---------------------------------------------------------------------- */}}
{{/* Guard 2 — cron.enabled with more than one replica.                      */}}
{{/*                                                                         */}}
{{/* A cron job installed in every replica RUNS ONCE PER REPLICA. Two        */}}
{{/* replicas means every tenant backup runs twice, every retention purge    */}}
{{/* runs twice, every calibration sweep notifies twice.                     */}}
{{/*                                                                         */}}
{{/* Turning that into a render failure rather than a silently double-running */}}
{{/* stack is the entire point of this guard.                                */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guard.cronReplicas" -}}
{{- if and .Values.backend.enabled .Values.backend.cron.enabled (gt (int .Values.backend.replicaCount) 1) -}}
{{- fail "\n\nbackend.cron.enabled is true with backend.replicaCount > 1.\n\nScheduled jobs are installed in EVERY replica and would run once per replica:\nevery tenant backup twice, every data-retention purge twice, every calibration\nsweep notifying twice.\n\nThe intended shape is two deployments:\n  - one replica  with cron.enabled=true   (the scheduler)\n  - N replicas   with cron.enabled=false  (the API)\n\nRefusing to render.\n" -}}
{{- end -}}
{{- end -}}

{{/* ---------------------------------------------------------------------- */}}
{{/* Guard 3 — the FOUR required secrets.                                    */}}
{{/*                                                                         */}}
{{/* CERT_SIGNING_SECRET, ENCRYPT_KEY, ATTACHMENT_URL_SECRET, KMS_MASTER_KEY  */}}
{{/* (the fourth was missing until S-05; compose and the Makefile had it).    */}}
{{/* The application EXITS without these. Failing at render is better than    */}}
{{/* failing in a crash loop, and much better than a partially-configured    */}}
{{/* deployment that starts and is permanently broken.                       */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guard.requiredSecrets" -}}
{{- if not (include "callibrator.externalSecrets" .) -}}
{{- if not .Values.secrets.certSigningSecret -}}
{{- fail "\n\nsecrets.certSigningSecret is required (or set global.secrets.external.enabled=true).\n\nThe application exits without it. Losing it later is unrecoverable: every\nissued certificate permanently fails public verification, and the key cannot\nbe re-derived from the data.\n\nBACK IT UP SEPARATELY FROM THE DATABASE.\n" -}}
{{- end -}}
{{- if not .Values.secrets.encryptKey -}}
{{- fail "\n\nsecrets.encryptKey is required (or set global.secrets.external.enabled=true).\n\nThe application exits without it. Losing it later makes every tenant private\nkey and every stored storage credential undecryptable.\n\nBACK IT UP SEPARATELY FROM THE DATABASE.\n" -}}
{{- end -}}
{{- if not .Values.secrets.attachmentUrlSecret -}}
{{- fail "\n\nsecrets.attachmentUrlSecret is required (or set global.secrets.external.enabled=true).\n" -}}
{{- end -}}
{{- if not .Values.secrets.kmsMasterKey -}}
{{- fail "\n\nsecrets.kmsMasterKey is required (or set global.secrets.external.enabled=true).\n\nKMS_MASTER_KEY wraps every tenant secret (SSO certificates, OIDC, Stripe and\nwebhook secrets). In production the backend THROWS AT STARTUP without it and the pod\ncrash-loops (S-05). Generate one with: openssl rand -hex 32\n\nBACK IT UP SEPARATELY FROM THE DATABASE.\n" -}}
{{- end -}}
{{- if and .Values.secrets.jwtAccessSecret (eq .Values.secrets.jwtAccessSecret .Values.secrets.jwtRefreshSecret) -}}
{{- fail "\n\nsecrets.jwtAccessSecret and secrets.jwtRefreshSecret are identical.\n\nEqual secrets mean an access token can be presented as a refresh token.\n" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* ---------------------------------------------------------------------- */}}
{{/* Guard 4 — CORS in production.                                           */}}
{{/*                                                                         */}}
{{/* With NODE_ENV=production and no configured origins, the application     */}}
{{/* rejects every cross-origin request. That fail-closed behaviour is       */}}
{{/* correct, and it is better caught here than in a browser.                */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guard.cors" -}}
{{- if and (eq (default "" .Values.backend.env.NODE_ENV) "production") (not .Values.global.corsOrigin) -}}
{{- fail "\n\nglobal.corsOrigin is empty with NODE_ENV=production.\n\nThe application rejects every cross-origin request in that state (correctly —\nthe CORS policy runs with credentials:true, so a wildcard is never honoured).\n\nSet an explicit, comma-separated origin list.\n" -}}
{{- end -}}
{{- end -}}

{{/* ---------------------------------------------------------------------- */}}
{{/* Guard 5 — values that moved.                                            */}}
{{/*                                                                         */}}
{{/* These keys used to exist and would now be IGNORED silently, which is    */}}
{{/* how S-06 happened: a name set in one place and read in another. A value */}}
{{/* that is ignored should refuse to render instead.                        */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guard.movedValues" -}}
{{- if (dig "external" nil (.Values.secrets | default dict)) -}}
{{- fail "\n\nsecrets.external has moved to global.secrets.external (S-06).\n\nThe backend subchart must compute the same Secret name the umbrella creates,\nand a subchart can read only its own values and .Values.global.\n" -}}
{{- end -}}
{{- if and .Values.backend (hasKey .Values.backend "secretName") -}}
{{- fail "\n\nbackend.secretName is no longer read (S-06). The backend reads the chart-managed\nSecret <base>-secrets, or global.secrets.external.secretName.\n" -}}
{{- end -}}
{{- if or .Values.fullnameOverride .Values.nameOverride -}}
{{- fail "\n\nfullnameOverride / nameOverride are not read by the subcharts. Use\nglobal.fullnameOverride, which every chart in the tree names objects from (S-27).\n" -}}
{{- end -}}
{{- end -}}

{{/* ---------------------------------------------------------------------- */}}
{{/* Guard 6 — the clamav provider with nowhere to scan (S-31).              */}}
{{/*                                                                         */}}
{{/* Since S-04 the backend FAILS CLOSED when VIRUS_SCAN_PROVIDER=clamav and  */}}
{{/* clamd is not configured: every upload is refused 422. The chart runs no */}}
{{/* ClamAV, so an empty backend.clamav.host would render a release that     */}}
{{/* accepts no attachment. Refuse at render instead.                        */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guard.clamav" -}}
{{- if and .Values.backend.enabled (eq (default "" .Values.backend.env.VIRUS_SCAN_PROVIDER) "clamav") (not .Values.backend.clamav.host) -}}
{{- fail "\n\nbackend.env.VIRUS_SCAN_PROVIDER is clamav but backend.clamav.host is empty.\n\nThis chart runs no ClamAV; clamd is provided externally, like PostgreSQL.\nWithout a host the backend refuses EVERY upload (422, fail-closed since S-04).\n\nSet --set backend.clamav.host=<clamd service> (port: backend.clamav.port, 3310),\nor set backend.env.VIRUS_SCAN_PROVIDER=none to run without scanning — a\ndecision to record, not a default.\n" -}}
{{- end -}}
{{- end -}}

{{/* ---------------------------------------------------------------------- */}}
{{/* Guard 7 — scheduled backups with nowhere durable to write (S-18).       */}}
{{/*                                                                         */}}
{{/* The BACKUP_SCHEDULER job writes tenant backup ZIPs to /app/backup. With */}}
{{/* no volume there they land in the container layer, vanish on the next   */}}
{{/* rollout, and leave tenant_backups rows saying `completed`.             */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guard.backupVolume" -}}
{{- if and .Values.backend.enabled .Values.backend.cron.enabled (ne (toString .Values.backend.cron.backup) "disabled") (not .Values.backend.backupPersistence.enabled) -}}
{{- fail "\n\nbackend.cron.enabled is true but backend.backupPersistence.enabled is false.\n\nThe scheduled tenant backup writes to /app/backup. Without a volume the ZIPs\nare lost on the next rollout while their rows still say `completed` (S-18).\n\nEnable backend.backupPersistence, or set backend.cron.backup=disabled and\nrecord where tenant backups are taken instead.\n" -}}
{{- end -}}
{{- end -}}

{{/* ---------------------------------------------------------------------- */}}
{{/* Guard 8 — production uploads on the container layer (S-18).             */}}
{{/*                                                                         */}}
{{/* Attachments are written to /app/uploads whatever STORAGE_DRIVER says.   */}}
{{/* Without persistence every upload disappears on the next rollout.        */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guard.uploadsVolume" -}}
{{- if and .Values.backend.enabled (eq (default "" .Values.backend.env.NODE_ENV) "production") (not .Values.backend.persistence.enabled) -}}
{{- fail "\n\nbackend.persistence.enabled is false with NODE_ENV=production.\n\nAttachments (and, with storage.driver=local, every stored object) are written to\nlocal disk. Without persistence they are lost on the next rollout (S-18).\n" -}}
{{- end -}}
{{- end -}}

{{/* ---------------------------------------------------------------------- */}}
{{/* Guard 9 — credentials in the ConfigMap (S-09).                          */}}
{{/*                                                                         */}}
{{/* redis.url and rabbitmq.url are rendered into the ConfigMap, which        */}}
{{/* `kubectl get cm -o yaml` prints to anyone who can read it. A URL with   */}}
{{/* user:password@ belongs in the Secret: secrets.redisPassword and          */}}
{{/* secrets.rabbitmqUrl.                                                     */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guard.credentialsInConfigMap" -}}
{{- range $name, $url := dict "backend.redis.url" (toString .Values.backend.redis.url) "backend.rabbitmq.url" (toString .Values.backend.rabbitmq.url) -}}
{{- if regexMatch "^[a-z+]+://[^/@]*@" $url -}}
{{- fail (printf "\n\n%s carries credentials (user:password@).\n\nIt is rendered into the ConfigMap, which is not secret. Put the Redis password in\nsecrets.redisPassword (REDIS_PASSWORD) and the full RabbitMQ URL in\nsecrets.rabbitmqUrl — both go to the Secret — and leave the URL here\ncredential-free (S-09).\n" $name) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* ---------------------------------------------------------------------- */}}
{{/* Run every guard. Included from NOTES.txt so it evaluates on template,   */}}
{{/* lint and install alike.                                                 */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guards" -}}
{{- /* First: a moved value would otherwise surface as a misleading later error. */ -}}
{{- include "callibrator.guard.movedValues" . -}}
{{- include "callibrator.guard.imageTag" . -}}
{{- include "callibrator.guard.cronReplicas" . -}}
{{- include "callibrator.guard.requiredSecrets" . -}}
{{- include "callibrator.guard.cors" . -}}
{{- include "callibrator.guard.clamav" . -}}
{{- include "callibrator.guard.backupVolume" . -}}
{{- include "callibrator.guard.uploadsVolume" . -}}
{{- include "callibrator.guard.credentialsInConfigMap" . -}}
{{- end -}}
