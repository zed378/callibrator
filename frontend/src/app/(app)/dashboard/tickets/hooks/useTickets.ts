// src/app/dashboard/tickets/hooks/useTickets.ts
import { useCallback, useEffect, useState } from "react";
import {
  ticketService,
  Ticket,
  TicketFilters,
} from "@/api/services/ticket.service";

export interface UseTicketsOptions {
  // When true, the list is permanently scoped to the caller's own tickets
  // (raised by / assigned to them) — used by the Raise page. The "mine" toggle
  // is then irrelevant and should not be surfaced.
  fixedMine?: boolean;
}

export function useTickets({ fixedMine = false }: UseTicketsOptions = {}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 25, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setError(null);
    try {
      const filters: TicketFilters = { page, limit: 25 };
      if (status) filters.status = status as TicketFilters["status"];
      if (priority) filters.priority = priority as TicketFilters["priority"];
      if (fixedMine || mine) filters.mine = true;
      if (q.trim()) filters.q = q.trim();
      const res = await ticketService.list(filters);
      setTickets(res.data);
      setMeta({
        total: res.meta.total ?? 0,
        page: res.meta.page,
        limit: res.meta.limit,
        totalPages: res.meta.totalPages,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setIsLoading(false);
    }
  }, [status, priority, mine, q, page, fixedMine]);

  useEffect(() => {
    let active = true;
    (async () => {
      await Promise.resolve();
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const changeFilter = (setter: (v: never) => void) => (v: never) => {
    setIsLoading(true);
    setter(v);
    setPage(1);
  };

  return {
    tickets,
    meta,
    isLoading,
    error,
    status,
    setStatus: changeFilter(setStatus as (v: never) => void),
    priority,
    setPriority: changeFilter(setPriority as (v: never) => void),
    mine,
    setMine: changeFilter(setMine as (v: never) => void),
    q,
    setQ,
    page,
    setPage,
    refresh: load,
  };
}

export default useTickets;
