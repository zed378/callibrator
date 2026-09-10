import React from "react";
import { AlertCircle, Check, Info, X, AlertTriangle } from "lucide-react";

interface AlertProps {
  variant?: "default" | "success" | "warning" | "error" | "info";
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  variant = "default",
  title,
  children,
  onClose,
  className = "",
}) => {
  const variantStyles = {
    default: "bg-muted text-foreground border-border",
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    error: "bg-destructive/10 text-destructive border-destructive/30",
    info: "bg-info/10 text-info border-info/30",
  };

  const iconStyles = {
    default: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    error: "text-destructive",
    info: "text-info",
  };

  const icons = {
    default: <Info className="h-5 w-5" />,
    success: <Check className="h-5 w-5" />,
    warning: <AlertTriangle className="h-5 w-5" />,
    error: <AlertCircle className="h-5 w-5" />,
    info: <Info className="h-5 w-5" />,
  };

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-xl border backdrop-blur-sm ${
        variantStyles[variant]
      } ${className}`}
    >
      <div className={`flex-shrink-0 ${iconStyles[variant]}`}>
        {icons[variant]}
      </div>
      <div className="flex-1">
        {title && <h3 className="text-sm font-semibold">{title}</h3>}
        <div className="text-sm mt-1">{children}</div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded hover:bg-foreground/10"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
