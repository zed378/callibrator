"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deferEffect } from "@/lib/deferEffect";
import type { components } from "@/api/typed";

type PageMeta = components["schemas"]["PaginationMeta"];

/** One page of a list: the rows, and the paging the envelope carried beside them. */
export interface Paged<T> {
  rows: T[];
  meta: PageMeta;
}

/** One paged list's state: loading, failed (never shown as empty) or its rows and paging. */
export interface PagedState<T> {
  rows: T[];
  meta: PageMeta | null;
  loading: boolean;
  error: unknown;
  page: number;
  setPage: (page: number) => void;
  reload: () => Promise<void>;
}

/**
 * P22-01 (promoted by P22-05, a second domain uses it) — loads one page of a list whenever the page or `fetchPage` changes (the caller
 * memoises `fetchPage` over its filters and sets page 1 when a filter changes). An answer that
 * arrives after a newer request started is dropped, so a slow first page never overwrites a later
 * filter's rows.
 */
export function usePaged<T>(fetchPage: (page: number) => Promise<Paged<T>>): PagedState<T> {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<T[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = latest.current + 1;
    latest.current = request;
    setLoading(true);
    setError(null);
    try {
      const answer = await fetchPage(page);
      if (latest.current !== request) return;
      setRows(answer.rows);
      setMeta(answer.meta);
    } catch (err) {
      if (latest.current !== request) return;
      setRows([]);
      setMeta(null);
      setError(err);
    } finally {
      if (latest.current === request) setLoading(false);
    }
  }, [fetchPage, page]);

  useEffect(() => deferEffect(reload), [reload]);

  return { rows, meta, loading, error, page, setPage, reload };
}
