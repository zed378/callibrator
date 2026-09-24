import { useId } from "react";

/**
 * F-12: the ids that associate a form control with its label and its message.
 *
 * - `controlId` goes on the control and in the label's `htmlFor` (the caller's
 *   own `id` wins when it passes one);
 * - `describedBy` points at the error when there is one, else at the helper
 *   text, else is undefined — so a screen reader reads the validation message
 *   with the field;
 * - `invalid` is the `aria-invalid` value: true only when there is an error.
 */
export function useFieldA11y(
  idProp: string | undefined,
  error: string | undefined,
  helperText: string | undefined,
) {
  const generated = useId();
  const controlId = idProp || generated;
  const messageId = `${controlId}-message`;
  return {
    controlId,
    messageId,
    describedBy: error || helperText ? messageId : undefined,
    invalid: error ? (true as const) : undefined,
  };
}
