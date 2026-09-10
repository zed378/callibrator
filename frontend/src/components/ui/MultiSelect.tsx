"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
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
}

/**
 * Multi-value select: a chip trigger (removable Badges) + searchable dropdown
 * with checkmarks. Value/onChange are string[] arrays. Used for choosing many
 * categories on a post.
 */
export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = "Select…",
  className = "",
  disabled = false,
  emptyMessage = "No results found.",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchTerm("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div
        onClick={() => !disabled && setIsOpen((o) => !o)}
        className={`flex min-h-12 w-full flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 ring-1 ring-border transition-all ${
          disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer focus-within:ring-2 focus-within:ring-ring/50"
        }`}
      >
        {selected.length === 0 && (
          <span className="py-1 text-sm text-muted-foreground">{placeholder}</span>
        )}
        {selected.map((o) => (
          <span key={o.value} onClick={(e) => e.stopPropagation()}>
            <Badge variant="primary" size="sm" removable onRemove={() => remove(o.value)}>
              {o.label}
            </Badge>
          </span>
        ))}
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </div>

      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 z-50 mt-2 origin-top overflow-hidden rounded-xl bg-card text-card-foreground shadow-xl ring-1 ring-border animate-scale-in">
          <div className="relative border-b border-border">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search…"
              className="w-full border-none bg-transparent py-2.5 pl-9 pr-4 text-sm focus:outline-none"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.map((o) => {
              const isSel = value.includes(o.value);
              return (
                <li
                  key={o.value}
                  onClick={() => toggle(o.value)}
                  className={`flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-muted ${
                    isSel ? "font-semibold" : ""
                  }`}
                >
                  <span>{o.label}</span>
                  {isSel && <Check className="h-4 w-4 text-primary" />}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-4 py-2 text-sm text-muted-foreground">{emptyMessage}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
