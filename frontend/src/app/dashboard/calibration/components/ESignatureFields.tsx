import React from "react";
import { Input, Select } from "@/components/ui";
import { ShieldCheck } from "lucide-react";

/**
 * 21 CFR Part 11 signing credentials, shared by the approve / sign / revoke
 * modals. The regulation requires the signer to re-authenticate at the moment
 * of signing and to record what the signature means — the backend rejects any
 * of these three fields being absent.
 */

export interface ESignatureFormFields {
  authMethod: "password" | "mfa";
  authPayload: string;
  meaning: string;
}

interface ESignatureFieldsProps<T extends ESignatureFormFields> {
  form: T;
  setForm: React.Dispatch<React.SetStateAction<T>>;
  /** Suggested reasons for the `meaning` field. */
  meaningOptions?: string[];
}

export function ESignatureFields<T extends ESignatureFormFields>({
  form,
  setForm,
  meaningOptions,
}: ESignatureFieldsProps<T>) {
  return (
    <div className="space-y-4 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Electronic signature</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Re-enter your credentials to sign. This is recorded against the
        certificate as an auditable, attributable act.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Method
          </label>
          <Select
            value={form.authMethod}
            onChange={(value) =>
              setForm({ ...form, authMethod: value as "password" | "mfa" })
            }
            options={[
              { value: "password", label: "Password" },
              { value: "mfa", label: "MFA code" },
            ]}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            {form.authMethod === "mfa" ? "Authenticator code *" : "Password *"}
          </label>
          <Input
            required
            type={form.authMethod === "mfa" ? "text" : "password"}
            // Never let a browser store the signing credential.
            autoComplete="off"
            inputMode={form.authMethod === "mfa" ? "numeric" : undefined}
            value={form.authPayload}
            onChange={(e) => setForm({ ...form, authPayload: e.target.value })}
            placeholder={
              form.authMethod === "mfa" ? "6-digit code" : "Your password"
            }
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Meaning of signature *
        </label>
        <Input
          required
          list={meaningOptions ? "esig-meaning-options" : undefined}
          value={form.meaning}
          onChange={(e) => setForm({ ...form, meaning: e.target.value })}
          placeholder="e.g. Reviewed and approved"
        />
        {meaningOptions && (
          <datalist id="esig-meaning-options">
            {meaningOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        )}
      </div>
    </div>
  );
}

export default ESignatureFields;
