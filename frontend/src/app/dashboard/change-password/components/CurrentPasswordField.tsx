import React from "react";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui";

interface CurrentPasswordFieldProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  status: "idle" | "validating" | "valid" | "invalid";
}

export const CurrentPasswordField: React.FC<CurrentPasswordFieldProps> = ({
  value,
  onChange,
  error,
  status,
}) => (
  <div className="space-y-1.5">
    <Input
      label="Current Password"
      type="password"
      value={value}
      onChange={onChange}
      error={error}
      placeholder="Enter current password"
    />
    {status === "validating" && (
      <p className="text-xs text-info flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" />
        Verifying password...
      </p>
    )}
    {status === "valid" && (
      <p className="text-xs text-success flex items-center gap-1.5">
        <CheckCircle className="w-3 h-3" />
        Password is correct
      </p>
    )}
    {status === "invalid" && (
      <p className="text-xs text-destructive flex items-center gap-1.5">
        <XCircle className="w-3 h-3" />
        Incorrect password
      </p>
    )}
  </div>
);
