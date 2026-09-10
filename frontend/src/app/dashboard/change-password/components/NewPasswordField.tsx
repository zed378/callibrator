import React from "react";
import { Input } from "@/components/ui";
import { PasswordStrengthIndicator } from "./PasswordStrengthIndicator";

interface NewPasswordFieldProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
}

export const NewPasswordField: React.FC<NewPasswordFieldProps> = ({
  value,
  onChange,
  error,
}) => (
  <div className="space-y-2">
    <Input
      label="New Password"
      type="password"
      value={value}
      onChange={onChange}
      error={error}
      placeholder="Enter new password"
    />
    <PasswordStrengthIndicator password={value} />
  </div>
);
