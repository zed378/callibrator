import React from "react";
import { Eye, EyeOff } from "lucide-react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onRightIconClick?: () => void;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  onRightIconClick,
  className = "",
  type = "text",
  ...props
}) => {
  const [showPassword, setShowPassword] = React.useState(false);

  const inputType =
    type === "password" ? (showPassword ? "text" : "password") : type;

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium mb-2 text-foreground">
          {label}
        </label>
      )}

      <div className="relative">
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
            {leftIcon}
          </div>
        )}
        <input
          type={inputType}
          className={`w-full px-4 py-3 rounded-xl transition-all duration-200
            focus:outline-none focus:ring-2 focus:ring-ring/50
            disabled:opacity-50 disabled:cursor-not-allowed
            placeholder:text-muted-foreground
            ${leftIcon ? "pl-11" : ""}
            ${rightIcon || onRightIconClick || type === "password" ? "pr-11" : ""}
            ${
              error
                ? "border-2 border-destructive bg-destructive/5 text-foreground focus:ring-destructive/50"
                : "ring-1 ring-input bg-background text-foreground focus:ring-ring/50"
            }
            ${className}
          `}
          {...props}
        />

        {rightIcon && !onRightIconClick && (
          <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-muted-foreground">
            {rightIcon}
          </div>
        )}
        {onRightIconClick && (
          <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
            <button
              type="button"
              onClick={onRightIconClick}
              className="p-2.5 text-muted-foreground hover:text-foreground focus:outline-none transition-colors"
            >
              {rightIcon}
            </button>
          </div>
        )}
        {type === "password" && !rightIcon && !onRightIconClick && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-muted-foreground hover:text-foreground focus:outline-none transition-colors"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1 text-sm text-destructive">{error}</p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-sm text-muted-foreground">
          {helperText}
        </p>
      )}
    </div>
  );
};
