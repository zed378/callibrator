import React from "react";
import { useFieldA11y } from "./fieldA11y";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  helperText,
  className = "",
  id,
  ...props
}) => {
  // F-12: label, control and message are associated.
  const { controlId, messageId, describedBy, invalid } = useFieldA11y(
    id,
    error,
    helperText,
  );
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={controlId}
          className="block text-sm font-medium mb-2 text-foreground"
        >
          {label}
        </label>
      )}
      <textarea
        id={controlId}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={`
          w-full px-4 py-3 rounded-xl transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-ring/50
          disabled:opacity-50 disabled:cursor-not-allowed
          resize-y
          placeholder:text-muted-foreground
          ${
            error
              ? "border-2 border-destructive focus:ring-destructive/50 bg-destructive/10 text-foreground"
              : "ring-1 ring-border bg-muted/30 text-foreground focus:ring-ring/50"
          }
          ${className}
        `}
        {...props}
      />
      {error && (
        <p id={messageId} className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={messageId} className="mt-1 text-sm text-muted-foreground">
          {helperText}
        </p>
      )}
    </div>
  );
};
