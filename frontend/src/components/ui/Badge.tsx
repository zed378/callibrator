import React from "react";
import { X } from "lucide-react";

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
  size?: "sm" | "md";
  removable?: boolean;
  onRemove?: () => void;
  /** F-12: the remove button's accessible name — say WHAT it removes. */
  removeLabel?: string;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "default",
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

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${
        variantStyles[variant]
      } ${sizeStyles[size]} ${className}`}
    >
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
