// src/app/dashboard/calibration-scheduler/hooks/useScheduler.ts
import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import {
  calibrationSchedulerService,
  DueDevice,
  RunSummary,
} from "@/api/services/calibrationScheduler.service";

export function useScheduler() {
  const { user } = useAuthStore();
  const { addToast } = useToastStore();

  const isSuperAdmin = user?.role?.name === "SUPERADMIN";

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

  useEffect(() => {
    fetchDue();
  }, [fetchDue]);

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
