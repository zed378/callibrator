import React from "react";
import { CheckCircle, XCircle } from "lucide-react";

interface PasswordValidationProps {
  isValid: boolean;
  rules: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSymbol: boolean;
  };
}

const labels = [
  "At least 8 characters",
  "One uppercase letter",
  "One lowercase letter",
  "One number",
  "One special character",
];

export const PasswordValidation: React.FC<PasswordValidationProps> = ({
  isValid,
  rules,
}) => {
  if (!isValid) return null;

  const rulesList = [
    rules.minLength,
    rules.hasUppercase,
    rules.hasLowercase,
    rules.hasNumber,
    rules.hasSymbol,
  ];

  return (
    <div className="space-y-1">
      {rulesList.map((passed, i) => (
        <div
          key={labels[i]}
          className={`flex items-center gap-2 text-sm ${
            passed
              ? "text-success"
              : "text-muted-foreground"
          }`}
        >
          {passed ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          <span>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
};
