import React from "react";
import { CircleCheck, CircleDashed, Info, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { TONE_CLASSES, type StatusTone } from "@/lib/statusTone";

interface BadgeProps {
  children: React.ReactNode;
  variant?:
    | "default"
    | "primary"
    | "secondary"
    | "success"
    | "warning"
    | "danger"
    | "info";
  /**
   * ADR-122 (P11-05): a STATUS badge. The tone sets the shape and the icon
   * as well as the colour (lib/statusTone.ts), and overrides `variant`. Use it
   * for every domain state; `variant` stays for non-status chips (scopes,
   * counts, tags).
   */
  tone?: StatusTone;
  size?: "sm" | "md";
  removable?: boolean;
  onRemove?: () => void;
  /** F-12: the remove button's accessible name — say WHAT it removes. */
  removeLabel?: string;
  className?: string;
}

const TONE_ICON: Record<StatusTone, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  alarm: OctagonAlert,
  attention: TriangleAlert,
  current: CircleCheck,
  draft: CircleDashed,
  info: Info,
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "default",
  tone,
  size = "md",
  removable = false,
  onRemove,
  removeLabel = "Remove",
  className = "",
}) => {
  const variantStyles = {
    default: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    secondary: "bg-secondary text-secondary-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info",
  };

  const sizeStyles = {
    sm: "px-2 py-0.5 text-xs font-semibold tracking-wide",
    md: "px-2.5 py-0.5 text-sm font-semibold",
  };

  const ToneIcon = tone ? TONE_ICON[tone] : null;

  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center font-medium rounded-full ${
        tone ? `gap-1 ${TONE_CLASSES[tone]}` : variantStyles[variant]
      } ${sizeStyles[size]} ${className}`}
    >
      {ToneIcon && <ToneIcon aria-hidden={true} className={size === "sm" ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"} />}
      {removable ? (
        <span className="inline-flex items-center gap-1">
          {children}
          <button
            type="button"
            aria-label={removeLabel}
            onClick={onRemove}
            className="inline-flex items-center justify-center w-4 h-4 ml-1 rounded-full hover:bg-foreground/10"
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </button>
        </span>
      ) : (
        children
      )}
    </span>
  );
};
