"use client";

import React from "react";
import { useFieldA11y } from "./fieldA11y";

interface FormFieldProps {
  /** The control's id; generated when omitted. */
  id?: string;
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  children: React.ReactNode;
}

/** Props FormField puts on its control to associate it (F-12). */
interface FieldControlProps {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
}

/**
 * A label, one control and its message. F-12: when `children` is a single
 * element, FormField gives it an `id` (unless it has one), `aria-invalid`,
 * `aria-describedby` pointing at the message and `aria-required`, and the
 * label's `htmlFor` targets it — so a screen reader announces the field's name
 * and its validation error. The control must put those props on the element
 * that takes focus (native inputs do; ui/Select does).
 */
export const FormField: React.FC<FormFieldProps> = ({
  id,
  label,
  error,
  helperText,
  required,
  children,
}) => {
  const single = React.isValidElement<FieldControlProps>(children)
    ? children
    : null;
  const { controlId, messageId, describedBy, invalid } = useFieldA11y(
    id ?? single?.props.id,
    error,
    helperText,
  );
  const control = single
    ? React.cloneElement(single, {
        id: controlId,
        "aria-invalid": invalid,
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })
    : children;

  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={single ? controlId : undefined}
          className="block text-sm font-semibold text-foreground"
        >
          {label}
          {required && <span className="text-primary font-bold ml-0.5"> *</span>}
        </label>
      )}
      {control}
      {error && (
        <p id={messageId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={messageId} className="text-xs text-muted-foreground">
          {helperText}
        </p>
      )}
    </div>
  );
};
