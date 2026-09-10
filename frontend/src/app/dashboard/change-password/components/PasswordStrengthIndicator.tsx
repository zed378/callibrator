import React from "react";
import { CheckCircle, XCircle } from "lucide-react";

interface PasswordValidation {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
}

interface ValidationItemProps {
  label: string;
  isValid: boolean;
  colSpan?: number;
}

const ValidationItem: React.FC<ValidationItemProps> = ({
  label,
  isValid,
  colSpan,
}) => (
  <div
    className={`flex items-center gap-1.5 text-xs transition-all duration-300 ${
      isValid
        ? "text-success"
        : "text-muted-foreground"
    }`}
    style={colSpan ? { gridColumn: `span ${colSpan}` } : {}}
  >
    {isValid ? (
      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
    ) : (
      <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
    )}
    <span>{label}</span>
  </div>
);

export const PasswordStrengthIndicator: React.FC<{ password: string }> = ({
  password,
}) => {
  const validation: PasswordValidation = {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSymbol: /[!@#$%^&*(),.?":{}|<>]/.test(password),
  };

  const strengthScore = Object.values(validation).filter(Boolean).length;

  const getStrengthLabel = () => {
    if (strengthScore === 0) return "Enter a password";
    if (strengthScore <= 2) return "Weak";
    if (strengthScore <= 3) return "Fair";
    if (strengthScore <= 4) return "Good";
    return "Strong";
  };

  const getStrengthColor = () => {
    if (strengthScore <= 2) return "bg-destructive";
    if (strengthScore <= 3) return "bg-warning";
    if (strengthScore <= 4) return "bg-info";
    return "bg-success";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full ${getStrengthColor()} transition-all duration-500 rounded-full`}
            style={{ width: `${(strengthScore / 5) * 100}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground font-medium tabular-nums">
          {getStrengthLabel()}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <ValidationItem label="8+ characters" isValid={validation.minLength} />
        <ValidationItem label="Uppercase" isValid={validation.hasUppercase} />
        <ValidationItem label="Lowercase" isValid={validation.hasLowercase} />
        <ValidationItem label="Number" isValid={validation.hasNumber} />
        <ValidationItem
          label="Special char"
          isValid={validation.hasSymbol}
          colSpan={2}
        />
      </div>
    </div>
  );
};
