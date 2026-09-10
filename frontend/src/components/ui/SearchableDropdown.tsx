"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Search, X } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface SearchableDropdownProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
  renderOption?: (option: Option) => React.ReactNode;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = "Select an option...",
  className = "",
  disabled = false,
  allowClear = false,
  renderOption,
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = React.useMemo(() => {
    if (!searchTerm.trim()) return options;
    const lower = searchTerm.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(lower));
  }, [options, searchTerm]);

  const handleOptionClick = useCallback(
    (optionValue: string) => {
      onChange(optionValue);
      setIsOpen(false);
      setSearchTerm("");
      setHighlightIndex(-1);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "Escape":
          setIsOpen(false);
          setSearchTerm("");
          setHighlightIndex(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((prev) =>
            prev < filteredOptions.length - 1 ? prev + 1 : 0,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((prev) =>
            prev > 0 ? prev - 1 : filteredOptions.length - 1,
          );
          break;
        case "Enter":
          if (highlightIndex >= 0 && highlightIndex < filteredOptions.length) {
            e.preventDefault();
            handleOptionClick(filteredOptions[highlightIndex].value);
          }
          break;
      }
    },
    [isOpen, filteredOptions, highlightIndex, handleOptionClick],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchTerm("");
        setHighlightIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setHighlightIndex(-1);
  }, [searchTerm]);

  const handleClear = () => {
    onChange("");
    if (containerRef.current) {
      containerRef.current
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setSearchTerm("");
          }
        }}
        onKeyDown={(e) => {
          if (!disabled) {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
              e.preventDefault();
              setIsOpen(true);
            }
            if (e.key === "Delete" || e.key === "Backspace") {
              if (value && allowClear) {
                handleClear();
              }
            }
          }
        }}
        aria-haspopup="listbox"
        className={`w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-ring/50 text-left flex items-center justify-between transition-all duration-200
          ring-1 ring-border
          ${
            disabled
              ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
              : "bg-muted/50 text-foreground focus:ring-ring/50 cursor-pointer"
          }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedOption ? (
            <span className="truncate flex-1">
              {renderOption
                ? renderOption(selectedOption)
                : selectedOption.label}
            </span>
          ) : (
            <span className="text-muted-foreground truncate flex-1">
              {placeholder}
            </span>
          )}
          {value && allowClear && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 text-muted-foreground ${
            isOpen ? "rotate-180" : ""
          }`}
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
          className="absolute z-50 left-0 right-0 mt-2 rounded-xl shadow-xl overflow-hidden backdrop-blur-md animate-scale-in origin-top bg-white/95 text-foreground"
          role="listbox"
        >
          <div className="relative border-b border-border">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={searchPlaceholder}
              onKeyDown={handleKeyDown}
              className="w-full pl-9 pr-4 py-2.5 bg-transparent border-none focus:outline-none text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.map((option, index) => (
              <li
                key={option.value}
                onClick={() => handleOptionClick(option.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOptionClick(option.value);
                  }
                }}
                role="option"
                aria-selected={value === option.value}
                tabIndex={-1}
                className={`px-4 py-2.5 cursor-pointer text-sm transition-colors ${
                  index === highlightIndex
                    ? "bg-muted"
                    : ""
                } ${
                  value === option.value
                    ? "bg-primary/10 font-bold"
                    : "hover:bg-muted"
                }`}
              >
                {renderOption ? renderOption(option) : option.label}
              </li>
            ))}
            {filteredOptions.length === 0 && (
              <li className="px-4 py-2 text-sm text-muted-foreground">
                {emptyMessage}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
