"use client";

import React, { useState, useRef, useEffect, useCallback, useId } from "react";
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
  /**
   * F-12: put on the trigger button, so a `<label htmlFor>` (or a FormField)
   * names it and its message is read with it — the pattern of ui/Select.
   */
  id?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
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
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}) => {
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const optionId = (index: number) => `${generatedId}-option-${index}`;
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

  // A-302: clearing clears — it used to dispatch a click on the trigger,
  // which toggled the list open. The list closes, and focus goes back to the
  // trigger, because the clear button it was on is removed with the value.
  const handleClear = () => {
    onChange("");
    setIsOpen(false);
    setSearchTerm("");
    containerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        id={id}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
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
        </div>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 text-muted-foreground ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {/* F-12: the clear control sits BESIDE the trigger (a button inside a
          button is invalid and was unreachable), and says what it does. */}
      {value && allowClear && !disabled && (
        <button
          type="button"
          aria-label="Clear selection"
          onClick={(e) => {
            e.stopPropagation();
            handleClear();
          }}
          className="absolute right-10 top-1/2 -translate-y-1/2 shrink-0 p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden="true" className="w-3.5 h-3.5" />
        </button>
      )}

      {isOpen && (
        <div
          className="absolute z-50 left-0 right-0 mt-2 rounded-xl shadow-xl overflow-hidden backdrop-blur-md animate-scale-in origin-top bg-popover text-popover-foreground border border-border"
        >
          <div className="relative border-b border-border">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              aria-label="Search options"
              aria-controls={listboxId}
              aria-activedescendant={
                highlightIndex >= 0 ? optionId(highlightIndex) : undefined
              }
              value={searchTerm}
              onChange={(e) => {
                // A new term re-filters the list: the old highlight no longer
                // points at the same option.
                setSearchTerm(e.target.value);
                setHighlightIndex(-1);
              }}
              placeholder={searchPlaceholder}
              onKeyDown={handleKeyDown}
              className="w-full pl-9 pr-4 py-2.5 bg-transparent border-none focus:outline-none text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          {/* F-12: the listbox is the list itself, named — not a wrapper
              that also holds the search box. */}
          <ul
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel || "Options"}
            className="max-h-60 overflow-y-auto py-1"
          >
            {filteredOptions.map((option, index) => (
              <li
                key={option.value}
                id={optionId(index)}
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
          </ul>
          {filteredOptions.length === 0 && (
            <p role="status" className="px-4 py-2 text-sm text-muted-foreground">
              {emptyMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
