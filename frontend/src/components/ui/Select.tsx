import React, { useState, useRef, useEffect, useCallback } from "react";

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder = "Select an option...",
  className = "",
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const handleOptionClick = useCallback(
    (optionValue: string) => {
      onChange(optionValue);
      setIsOpen(false);
    },
    [onChange],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
    if (e.key === "Enter" || e.key === " ") {
      setIsOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={(e) => !disabled && handleKeyDown(e)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={`w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-ring/50 text-left flex items-center justify-between transition-all duration-200
          ring-1 ring-border
          ${
            disabled
              ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
              : "bg-muted/50 text-foreground focus:ring-ring/50 cursor-pointer"
          }`}
      >
        <span
          className={selectedOption ? "" : "text-muted-foreground"}
        >
          {selectedOption?.label || placeholder}
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          } ${"text-muted-foreground"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute z-50 left-0 right-0 mt-2 rounded-xl shadow-xl overflow-hidden animate-scale-in origin-top bg-card text-foreground border border-border"
          role="listbox"
        >
          <ul className="max-h-60 overflow-y-auto py-1">
            {options.map((option) => (
              <li
                key={option.value}
                onClick={() => handleOptionClick(option.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    handleOptionClick(option.value);
                  }
                }}
                role="option"
                aria-selected={value === option.value}
                className={`px-4 py-2.5 cursor-pointer text-sm transition-colors
                  ${
                    value === option.value
                      ? "bg-primary/10 text-primary font-bold"
                      : "text-foreground hover:bg-muted"
                  }`}
              >
                {option.label}
              </li>
            ))}
            {options.length === 0 && (
              <li className="px-4 py-2 text-sm text-muted-foreground">
                No options available
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
