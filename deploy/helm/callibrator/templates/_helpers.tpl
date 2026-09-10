{{/* Common naming and labelling helpers. */}}

{{- define "callibrator.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "callibrator.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
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

{{/* The Secret the backend reads from — external, or chart-managed. */}}
{{- define "callibrator.secretName" -}}
{{- if .Values.secrets.external.enabled -}}
{{- .Values.secrets.external.secretName -}}
{{- else -}}
{{- printf "%s-secrets" (include "callibrator.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "callibrator.configMapName" -}}
{{- printf "%s-config" (include "callibrator.fullname" .) -}}
{{- end -}}
