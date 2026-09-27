"use client";

import React, { useState, useRef, useEffect, useMemo, useId } from "react";
import { Search, Check, ChevronDown } from "lucide-react";
import { Badge } from "./Badge";

interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  emptyMessage?: string;
  /**
   * F-12: put on the trigger button, so a `<label htmlFor>` (or a FormField)
   * names it and its message is read with it — the pattern of ui/Select.
   */
  id?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
}

/**
 * Multi-value select: a chip trigger (removable Badges) + searchable dropdown
 * with checkmarks. Value/onChange are string[] arrays. Used for choosing many
 * categories on a post.
 *
 * F-12: the trigger is a real `<button>` (focusable, named by its label, with
 * `aria-expanded`/`aria-haspopup`); the options are a named, multi-selectable
 * `listbox` driven from the search box with the arrow keys, Enter and Escape
 * (`aria-activedescendant`); each chip's remove button says which value it
 * removes.
 */
export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = "Select…",
  className = "",
  disabled = false,
  emptyMessage = "No results found.",
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const generatedId = useId();
  const triggerId = id || `${generatedId}-trigger`;
  const listboxId = `${generatedId}-listbox`;
  const optionId = (index: number) => `${generatedId}-option-${index}`;

  const selected = useMemo(
    () => options.filter((o) => value.includes(o.value)),
    [options, value],
  );
  const filtered = useMemo(() => {
    const l = searchTerm.trim().toLowerCase();
    return l ? options.filter((o) => o.label.toLowerCase().includes(l)) : options;
  }, [options, searchTerm]);

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const remove = (v: string) => onChange(value.filter((x) => x !== v));

  const close = (returnFocus: boolean) => {
    setIsOpen(false);
    setSearchTerm("");
    setHighlight(-1);
    if (returnFocus) triggerRef.current?.focus();
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlight((h) => (filtered.length ? (h + 1) % filtered.length : -1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) =>
          filtered.length ? (h <= 0 ? filtered.length - 1 : h - 1) : -1,
        );
        break;
      case "Enter":
        if (highlight >= 0 && highlight < filtered.length) {
          e.preventDefault();
          toggle(filtered[highlight].value);
        }
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
    }
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchTerm("");
        setHighlight(-1);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* A mouse convenience: clicking the chip area opens the list. The
          keyboard path is the button inside it. */}
      <div
        onClick={() => !disabled && setIsOpen((o) => !o)}
        className={`flex min-h-12 w-full flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 ring-1 ring-border transition-all ${
          disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer focus-within:ring-2 focus-within:ring-ring/50"
        }`}
      >
        {selected.map((o) => (
          <span key={o.value} onClick={(e) => e.stopPropagation()}>
            <Badge
              variant="primary"
              size="sm"
              removable
              removeLabel={`Remove ${o.label}`}
              onRemove={() => remove(o.value)}
            >
              {o.label}
            </Badge>
          </span>
        ))}
        <button
          ref={triggerRef}
          type="button"
          id={triggerId}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-describedby={ariaDescribedBy}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((o) => !o);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && isOpen) {
              e.preventDefault();
              close(false);
            }
          }}
          className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md py-1 text-left text-sm focus:outline-none ${
            disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <span className={selected.length === 0 ? "text-muted-foreground" : "sr-only"}>
            {selected.length === 0 ? placeholder : `${selected.length} selected`}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 z-50 mt-2 origin-top overflow-hidden rounded-xl bg-card text-card-foreground shadow-xl ring-1 ring-border animate-scale-in">
          <div className="relative border-b border-border">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              autoFocus
              type="text"
              aria-label="Search options"
              aria-controls={listboxId}
              aria-activedescendant={highlight >= 0 ? optionId(highlight) : undefined}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setHighlight(-1);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Search…"
              className="w-full border-none bg-transparent py-2.5 pl-9 pr-4 text-sm focus:outline-none"
            />
          </div>
          <ul
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={ariaLabel || "Options"}
            className="max-h-60 overflow-y-auto py-1"
          >
            {filtered.map((o, index) => {
              const isSel = value.includes(o.value);
              return (
                <li
                  key={o.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSel}
                  onClick={() => toggle(o.value)}
                  className={`flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-muted ${
                    isSel ? "font-semibold" : ""
                  } ${index === highlight ? "bg-muted" : ""}`}
                >
                  <span>{o.label}</span>
                  {isSel && <Check aria-hidden="true" className="h-4 w-4 text-primary" />}
                </li>
              );
            })}
          </ul>
          {filtered.length === 0 && (
            <p role="status" className="px-4 py-2 text-sm text-muted-foreground">
              {emptyMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
