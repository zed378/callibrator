// src/components/layouts/GlobalSearch.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Cpu, Package, FileText } from "lucide-react";
import {
  searchService,
  SearchResult,
  SearchResponse,
} from "@/api/services/search.service";

const TYPE_CONFIG: Record<
  SearchResult["type"],
  { label: string; href: string; icon: React.ReactNode }
> = {
  device: {
    label: "Devices",
    href: "/dashboard/devices",
    icon: <Cpu className="h-4 w-4 text-muted-foreground" />,
  },
  stock: {
    label: "Stock",
    href: "/dashboard/stock",
    icon: <Package className="h-4 w-4 text-muted-foreground" />,
  },
  certificate: {
    label: "Certificates",
    href: "/dashboard/calibration",
    icon: <FileText className="h-4 w-4 text-muted-foreground" />,
  },
};

const getPrimaryText = (result: SearchResult): string => {
  switch (result.type) {
    case "device":
      return result.name;
    case "stock":
      return result.itemName;
    case "certificate":
      return result.certificateNumber;
  }
};

const getSecondaryText = (result: SearchResult): string => {
  switch (result.type) {
    case "device":
      return result.serialNumber || result.model || result.category || "";
    case "stock":
      return result.sku || result.serialNumber || "";
    case "certificate":
      return result.status || "";
  }
};

export const GlobalSearch: React.FC<{ className?: string }> = ({
  className = "",
}) => {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await searchService.search(q, undefined, 10);
      if (requestId === requestIdRef.current) {
        setResponse(data);
        setIsOpen(true);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setResponse(null);
        setError(err instanceof Error ? err.message : "Search failed");
        setIsOpen(true);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Debounced search on input change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      // Invalidate in-flight requests and reset
      requestIdRef.current += 1;
      setResponse(null);
      setError(null);
      setIsLoading(false);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      runSearch(trimmed);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Close on outside click
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      setIsOpen(false);
      setQuery("");
      setResponse(null);
      router.push(TYPE_CONFIG[result.type].href);
    },
    [router],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (event.key === "Enter") {
      const first = response?.results?.[0];
      if (first && isOpen) {
        event.preventDefault();
        handleSelect(first);
      }
    }
  };

  const groups = (
    ["device", "stock", "certificate"] as const
  )
    .map((type) => ({
      type,
      items: (response?.byType?.[type] || []) as SearchResult[],
    }))
    .filter((group) => group.items.length > 0);

  const hasResults = groups.length > 0;

  return (
    <div ref={containerRef} className={`relative w-64 lg:w-72 ${className}`}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
          <Search className="h-4 w-4" />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim().length >= 2 && (response || error)) {
              setIsOpen(true);
            }
          }}
          placeholder="Search devices, stock, certificates..."
          aria-label="Global search"
          className="w-full pl-10 pr-10 py-2 text-sm rounded-xl transition-all duration-200
            ring-1 ring-input bg-background text-foreground
            placeholder:text-muted-foreground
            focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
        {isLoading && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-card border border-border rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto">
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive text-center">
              {error}
            </p>
          ) : !hasResults ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">
              No results for &ldquo;{query.trim()}&rdquo;
            </p>
          ) : (
            <div className="py-2">
              {groups.map((group) => (
                <div key={group.type}>
                  <p className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {TYPE_CONFIG[group.type].label}
                  </p>
                  {group.items.map((result) => {
                    const secondary = getSecondaryText(result);
                    return (
                      <button
                        key={`${result.type}-${result.id}`}
                        type="button"
                        onClick={() => handleSelect(result)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
                      >
                        <span className="flex-shrink-0">
                          {TYPE_CONFIG[result.type].icon}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground truncate">
                            {getPrimaryText(result)}
                          </span>
                          {secondary && (
                            <span className="block text-xs text-muted-foreground truncate">
                              {secondary}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
