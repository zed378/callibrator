// src/app/dashboard/calibration-scheduler/hooks/useScheduler.ts
import { deferEffect } from "@/lib/deferEffect";
import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToastStore } from "@/stores/toastStore";
import {
  calibrationSchedulerService,
  DueDevice,
  RunSummary,
} from "@/api/services/calibrationScheduler.service";

export function useScheduler() {
  const { addToast } = useToastStore();

  // A-301 (ADR-102): from the effective permissions, not the role name.
  // "All tenants" is honoured for the platform super admin only
  // (calibrationScheduler.controller#resolveScanScope); a run is
  // POST /calibration-scheduler/run, gated dynamicAccess("maintenance",
  // "create") — write on the `maintenance` menu.
  const { superAdmin: isSuperAdmin, canWrite } = usePermissions();
  const canRun = canWrite("maintenance");

  const [leadDays, setLeadDays] = useState(30);
  const [allTenants, setAllTenants] = useState(false);

  const [dueDevices, setDueDevices] = useState<DueDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);

  const fetchDue = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const devices = await calibrationSchedulerService.getDue({
        leadDays,
        allTenants: isSuperAdmin ? allTenants : undefined,
      });
      setDueDevices(devices);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load due devices",
      );
    } finally {
      setIsLoading(false);
    }
  }, [leadDays, allTenants, isSuperAdmin]);

  useEffect(() => deferEffect(fetchDue), [fetchDue]);

  const handleLeadDaysChange = (e: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(e.target.value);
    setLeadDays(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  };

  const handleRun = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const summary = await calibrationSchedulerService.run({
        leadDays,
        allTenants: isSuperAdmin ? allTenants : undefined,
      });
      setLastRun(summary);
      addToast({
        type: "success",
        title: `Scheduler complete: ${summary.workOrdersCreated} work order(s), ${summary.notificationsCreated} notification(s) created`,
      });
      await fetchDue();
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Scheduler run failed",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const clearLastRun = () => setLastRun(null);

  return {
    isSuperAdmin,
    canRun,
    leadDays,
    handleLeadDaysChange,
    allTenants,
    setAllTenants,
    dueDevices,
    isLoading,
    error,
    fetchDue,
    isRunning,
    handleRun,
    lastRun,
    clearLastRun,
  };
}

export default useScheduler;
