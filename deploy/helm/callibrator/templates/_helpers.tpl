{{/* Common naming and labelling helpers. */}}

{{- define "callibrator.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
ONE NAMING HELPER FOR THE WHOLE CHART TREE (S-06, S-27).

callibrator.baseName is the prefix of EVERY object this release creates or
references — the umbrella's ConfigMap, Secret and Ingress, and the subcharts'
Deployments, Services and PVC. The subcharts include it too: named templates
are shared across a chart and its subcharts, and it reads only .Release.Name
and .Values.global, which are identical in every chart of the tree.

It deliberately does NOT use .Chart.Name. The previous umbrella helper did, and
collapsed "<release>-callibrator" to "<release>" when the release name already
contained "callibrator", while the subcharts hard-coded
"<release>-callibrator-<x>". Under the Makefile's default release name
(`callibrator`) the ingress then targeted services that did not exist and the
backend's envFrom named a ConfigMap that did not exist (S-27); under any other
name, the backend named a Secret that did not exist (S-06).

  release "callibrator"  → callibrator-backend, callibrator-config, …
  release "prod"         → prod-callibrator-backend, prod-callibrator-config, …
  global.fullnameOverride=x → x-backend, x-config, …
*/}}
{{- define "callibrator.baseName" -}}
{{- $global := .Values.global | default dict -}}
{{- if $global.fullnameOverride -}}
{{- $global.fullnameOverride | trunc 50 | trimSuffix "-" -}}
{{- else if contains "callibrator" .Release.Name -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-callibrator" .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Kept for the umbrella's own templates; identical to baseName. */}}
{{- define "callibrator.fullname" -}}
{{- include "callibrator.baseName" . -}}
{{- end -}}

{{- define "callibrator.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "callibrator.labels" -}}
helm.sh/chart: {{ include "callibrator.chart" . }}
{{ include "callibrator.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "callibrator.selectorLabels" -}}
app.kubernetes.io/name: {{ include "callibrator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
The Secret the backend reads from — external, or chart-managed.

Driven by global.secrets.external so the backend SUBCHART computes the same
name the umbrella creates: a subchart cannot see the umbrella's top-level
values, only its own and .Values.global. (The subchart's old `secretName`
value defaulted to "callibrator-secrets", which the umbrella never set — S-06.)
*/}}
{{- define "callibrator.secretName" -}}
{{- $external := dig "secrets" "external" dict (.Values.global | default dict) -}}
{{- if $external.enabled -}}
{{- required "global.secrets.external.secretName is required when global.secrets.external.enabled is true" $external.secretName -}}
{{- else -}}
{{- printf "%s-secrets" (include "callibrator.baseName" .) -}}
{{- end -}}
{{- end -}}

{{- define "callibrator.externalSecrets" -}}
{{- if (dig "secrets" "external" "enabled" false (.Values.global | default dict)) -}}true{{- end -}}
{{- end -}}

{{- define "callibrator.configMapName" -}}
{{- printf "%s-config" (include "callibrator.baseName" .) -}}
{{- end -}}
