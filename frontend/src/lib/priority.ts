/**
 * ADR-122 (P11-05/P11-06): kanban and ticket PRIORITY is not a status
 * (doc 08) — it is never the alarm red, and never a status tone. A priority
 * chip is neutral, with a dot from the sequential copper ramp (--priority-*,
 * globals.css), and the priority's own word as its label.
 */
export const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-priority-urgent",
  high: "bg-priority-high",
  medium: "bg-priority-medium",
  low: "bg-priority-low",
  none: "bg-priority-none",
};

export const priorityDot = (priority: string | null | undefined): string =>
  PRIORITY_DOT[(priority ?? "").toLowerCase()] ?? "bg-priority-none";
