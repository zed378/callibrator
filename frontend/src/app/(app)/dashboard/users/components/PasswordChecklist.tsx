// src/app/dashboard/users/components/PasswordChecklist.tsx
"use client";

import React from "react";

interface PasswordChecklistProps {
  rules: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSymbol: boolean;
  };
}

export function PasswordChecklist({ rules }: PasswordChecklistProps) {
  const items = [
    { key: "minLength", label: "At least 8 characters" },
    { key: "hasUppercase", label: "One uppercase letter" },
    { key: "hasLowercase", label: "One lowercase letter" },
    { key: "hasNumber", label: "One number" },
    { key: "hasSymbol", label: "One special character" },
  ];

  return (
    <div className="space-y-1">
      {items.map(({ key, label }) => (
        <div
          key={key}
          className={`flex items-center gap-2 text-sm ${
            rules[key as keyof typeof rules]
              ? "text-success"
              : "text-muted-foreground"
          }`}
        >
          {rules[key as keyof typeof rules] ? (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          )}
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export default PasswordChecklist;
