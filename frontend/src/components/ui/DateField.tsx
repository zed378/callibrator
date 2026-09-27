import React, { forwardRef } from "react";
import { useFieldA11y } from "./fieldA11y";

interface DateFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label?: string;
  error?: string;
  helperText?: string;
  onChange: (value: string) => void;
}

export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(
  ({ label, error, helperText, onChange, value, id, ...props }, ref) => {
    // F-12: label, control and message are associated. Inside a FormField the
    // field's own id / aria-invalid / aria-describedby arrive in `props` and
    // win, since FormField renders the label and the message.
    const { controlId, messageId, describedBy, invalid } = useFieldA11y(
      id,
      error,
      helperText,
    );
    return (
      <div>
        {label && (
          <label
            htmlFor={controlId}
            className="block text-sm font-medium mb-2 text-muted-foreground"
          >
            {label}
          </label>
        )}
        <input
          id={controlId}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full px-4 py-3 rounded-xl transition-all duration-200
            focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary/50
            disabled:opacity-50 disabled:cursor-not-allowed
            placeholder:text-muted-foreground
            ${error
              ? "ring-1 ring-destructive bg-destructive/10 text-foreground"
              : "ring-1 ring-border bg-muted/30 text-foreground focus:ring-ring/50"
            }
            ${props.className || ""}`}
          ref={ref}
          {...props}
        />
        {error && (
          <p id={messageId} className="mt-1 text-sm text-destructive">{error}</p>
        )}
        {helperText && !error && (
          <p id={messageId} className="mt-1 text-sm text-muted-foreground">{helperText}</p>
        )}
      </div>
    );
  },
);

DateField.displayName = "DateField";
