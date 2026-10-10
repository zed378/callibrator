"use client";

/**
 * P23-02 (P19-06 § 7, § 12) — sign an IPM report: the performer's signature (meaning: authorship)
 * or the IPSRS countersignature (meaning: review). The meaning is shown BEFORE the credential and
 * must be acknowledged (Part 11 § 11.50); the credential — the password or a current authenticator
 * code — is re-entered now and sent with the request (never stored). A wrong credential is the
 * server's 401 shown inline (the client does not treat it as an expired session); a 403 / 409 is the
 * server's explanation (not the performer, the IPSRS rules, already signed, superseded, voided …).
 */
import React, { useState } from "react";
import { Alert, Button, Dialog } from "@/components/ui";
import { describeApiError } from "@/api/client";
import { ipmReportService } from "@/api/services/ipmReport.service";
import { FIELD } from "./shared";
import { useI18n } from "@/i18n/MessagesProvider";

interface Props {
  sessionId: string;
  reportNumber: string;
  kind: "performer" | "countersign";
  onClose: (signed: boolean) => void;
}

export function SignReportDialog({ sessionId, reportNumber, kind, onClose }: Props) {
  const { t } = useI18n();
  const [method, setMethod] = useState<"password" | "mfa">("password");
  const [credential, setCredential] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const performer = kind === "performer";
  const ready = acknowledged && credential.trim() !== "";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setShown(true);
    if (!ready) return;
    setBusy(true);
    setRefusal(null);
    try {
      await ipmReportService.sign(sessionId, { kind, authMethod: method, authPayload: credential, meaningAcknowledged: true });
      onClose(true);
    } catch (err) {
      setRefusal(describeApiError(err).message || t("ipmReport.sign.failed"));
      setCredential("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen
      onClose={() => onClose(false)}
      title={performer ? t("ipmReport.sign.titlePerformer", { number: reportNumber }) : t("ipmReport.sign.titleCountersign", { number: reportNumber })}
      size="md"
    >
      <form noValidate className="space-y-4" onSubmit={(e) => void submit(e)}>
        <p id="sign-meaning" className="rounded-md border border-border p-3 text-sm">
          {performer ? t("ipmReport.sign.meaningPerformer") : t("ipmReport.sign.meaningCountersign")}
        </p>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={acknowledged} aria-describedby="sign-meaning" onChange={(e) => setAcknowledged(e.target.checked)} />
          {t("ipmReport.sign.acknowledge")}
        </label>
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold">{t("ipmReport.sign.method")}</legend>
          {(["password", "mfa"] as const).map((m) => (
            <label key={m} className="flex min-h-9 items-center gap-2 text-sm">
              <input
                type="radio"
                name="sign-method"
                value={m}
                checked={method === m}
                onChange={() => {
                  setMethod(m);
                  setCredential("");
                }}
              />
              {t(m === "password" ? "ipmReport.sign.method.password" : "ipmReport.sign.method.mfa")}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1.5">
          <label htmlFor="sign-credential" className="block text-sm font-semibold">
            {method === "password" ? t("ipmReport.sign.password") : t("ipmReport.sign.code")}
          </label>
          <input
            id="sign-credential"
            type={method === "password" ? "password" : "text"}
            inputMode={method === "mfa" ? "numeric" : undefined}
            autoComplete={method === "password" ? "current-password" : "one-time-code"}
            className={`${FIELD} min-h-11`}
            value={credential}
            maxLength={1024}
            onChange={(e) => setCredential(e.target.value)}
          />
        </div>
        {shown && !ready && <p className="text-sm text-destructive">{t("ipmReport.sign.incomplete")}</p>}
        {refusal && (
          <div role="alert">
            <Alert variant="error" title={t("ipmReport.sign.failed")}>
              <p>{refusal}</p>
            </Alert>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onClose(false)}>
            {t("ipmReport.sign.cancel")}
          </Button>
          <Button type="submit" isLoading={busy}>
            {t("ipmReport.sign.confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
