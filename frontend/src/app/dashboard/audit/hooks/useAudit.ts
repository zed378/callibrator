// src/app/dashboard/audit/hooks/useAudit.ts
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
  AuditAction,
  AuditLog,
  AuditMeta,
  auditService,
} from "@/api/services/audit.service";
import { useAuthStore } from "@/stores/authStore";

const AUDIT_ACTIONS: AuditAction[] = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "APPROVE",
  "EXPORT",
  "ACCOUNT_LOCKED",
  "SIGNATURE_AUTH_FAILED",
];

/**
 * Whose trail is shown. "platform" is the reserved PLATFORM tenant (A-125):
 * tenant lifecycle, global roles and menus, and every suspension or flag
 * change (A-165). The backend answers it to a super admin only.
 */
export type AuditScope = "tenant" | "platform";

const SUPER_ADMIN_ROLES = new Set(["SUPERADMIN", "SUPER_ADMIN"]);

export function useAudit() {
  const user = useAuthStore((state) => state.user);
  const isSuperAdmin = SUPER_ADMIN_ROLES.has(user?.role?.name ?? "");

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
  const [scopeChoice, setScopeChoice] = useState<AuditScope>("tenant");
  // Only a super admin ever asks for the platform trail; anyone else reads
  // their own tenant whatever the state says.
  const scope: AuditScope = isSuperAdmin ? scopeChoice : "tenant";

  /**
   * `isCurrent` is false once the effect that started this fetch has been
   * cleaned up (a filter or the scope changed): a late response must not
   * overwrite the newer one.
   */
  const fetchLogs = useCallback(async (isCurrent: () => boolean = () => true) => {
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
        scope: scope === "platform" ? "platform" : undefined,
      });
      if (!isCurrent()) return;
      setLogs(result.logs);
      setMeta(result.meta);
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [currentPage, pageSize, actionFilter, resourceTypeFilter, startDate, endDate, scope]);

  useEffect(() => {
    // Deferred past the synchronous effect body: fetchLogs sets loading state
    // at once, which react-hooks/set-state-in-effect refuses there. The flag
    // drops a response that arrives after this effect was superseded.
    let active = true;
    queueMicrotask(() => {
      if (active) void fetchLogs(() => active);
    });
    return () => {
      active = false;
    };
  }, [fetchLogs]);

  const handleScopeChange = (value: AuditScope) => {
    setScopeChoice(value);
    setCurrentPage(1);
  };

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
    isSuperAdmin,
    scope,
    handleScopeChange,
    refresh: () => fetchLogs(),
  };
}

export default useAudit;
