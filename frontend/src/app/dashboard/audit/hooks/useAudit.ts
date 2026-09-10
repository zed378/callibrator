// src/app/dashboard/audit/hooks/useAudit.ts
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
  AuditAction,
  AuditLog,
  AuditMeta,
  auditService,
} from "@/api/services/audit.service";

const AUDIT_ACTIONS: AuditAction[] = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "APPROVE",
  "EXPORT",
];

export function useAudit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState<AuditMeta>({
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  const [actionFilter, setActionFilter] = useState(""); // "" = all
  const [resourceTypeFilter, setResourceTypeFilter] = useState("");
  const [startDate, setStartDate] = useState(""); // yyyy-mm-dd from <input type="date">
  const [endDate, setEndDate] = useState("");

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const action = AUDIT_ACTIONS.includes(actionFilter as AuditAction)
        ? (actionFilter as AuditAction)
        : undefined;

      const result = await auditService.getAll({
        page: currentPage,
        limit: pageSize,
        action,
        resourceType: resourceTypeFilter || undefined,
        startDate: startDate ? `${startDate}T00:00:00` : undefined,
        endDate: endDate ? `${endDate}T23:59:59` : undefined,
      });
      setLogs(result.logs);
      setMeta(result.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, actionFilter, resourceTypeFilter, startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleActionFilterChange = (value: string) => {
    setActionFilter(value);
    setCurrentPage(1);
  };

  const handleResourceTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setResourceTypeFilter(e.target.value);
    setCurrentPage(1);
  };

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStartDate(e.target.value);
    setCurrentPage(1);
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEndDate(e.target.value);
    setCurrentPage(1);
  };

  return {
    logs,
    meta,
    isLoading,
    error,
    currentPage,
    setCurrentPage,
    pageSize,
    actionFilter,
    resourceTypeFilter,
    startDate,
    endDate,
    handleActionFilterChange,
    handleResourceTypeChange,
    handleStartDateChange,
    handleEndDateChange,
    refresh: fetchLogs,
  };
}

export default useAudit;
