import React from "react";
import { CheckCircle, XCircle } from "lucide-react";
import { Input } from "@/components/ui";

interface ConfirmPasswordFieldProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  /** Live comparison against the new password. "idle" while empty. */
  matchStatus?: "idle" | "match" | "mismatch";
}

export const ConfirmPasswordField: React.FC<ConfirmPasswordFieldProps> = ({
  value,
  onChange,
  error,
  matchStatus = "idle",
}) => (
  <div className="space-y-1.5">
    <Input
      label="Confirm New Password"
      type="password"
      value={value}
      onChange={onChange}
      error={error}
      placeholder="Confirm new password"
    />
    {/* Suppressed while a submit-time error is shown, so the mismatch
        message never appears twice. */}
    {!error && matchStatus === "match" && (
      <p className="text-xs text-success flex items-center gap-1.5">
        <CheckCircle className="w-3 h-3" />
        Passwords match
      </p>
    )}
    {!error && matchStatus === "mismatch" && (
      <p className="text-xs text-destructive flex items-center gap-1.5">
        <XCircle className="w-3 h-3" />
        Passwords do not match
      </p>
    )}
  </div>
);
