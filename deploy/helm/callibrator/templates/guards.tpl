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
{{/* Guard 3 — the three required secrets.                                   */}}
{{/*                                                                         */}}
{{/* The application EXITS without these. Failing at render is better than    */}}
{{/* failing in a crash loop, and much better than a partially-configured    */}}
{{/* deployment that starts and is permanently broken.                       */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guard.requiredSecrets" -}}
{{- if not .Values.secrets.external.enabled -}}
{{- if not .Values.secrets.certSigningSecret -}}
{{- fail "\n\nsecrets.certSigningSecret is required (or set secrets.external.enabled=true).\n\nThe application exits without it. Losing it later is unrecoverable: every\nissued certificate permanently fails public verification, and the key cannot\nbe re-derived from the data.\n\nBACK IT UP SEPARATELY FROM THE DATABASE.\n" -}}
{{- end -}}
{{- if not .Values.secrets.encryptKey -}}
{{- fail "\n\nsecrets.encryptKey is required (or set secrets.external.enabled=true).\n\nThe application exits without it. Losing it later makes every tenant private\nkey and every stored storage credential undecryptable.\n\nBACK IT UP SEPARATELY FROM THE DATABASE.\n" -}}
{{- end -}}
{{- if not .Values.secrets.attachmentUrlSecret -}}
{{- fail "\n\nsecrets.attachmentUrlSecret is required (or set secrets.external.enabled=true).\n" -}}
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
{{/* Run every guard. Included from NOTES.txt so it evaluates on template,   */}}
{{/* lint and install alike.                                                 */}}
{{/* ---------------------------------------------------------------------- */}}
{{- define "callibrator.guards" -}}
{{- include "callibrator.guard.imageTag" . -}}
{{- include "callibrator.guard.cronReplicas" . -}}
{{- include "callibrator.guard.requiredSecrets" . -}}
{{- include "callibrator.guard.cors" . -}}
{{- end -}}
