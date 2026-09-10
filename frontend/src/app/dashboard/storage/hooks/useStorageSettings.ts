// src/app/dashboard/storage/hooks/useStorageSettings.ts
import { useCallback, useEffect, useState } from "react";
import { useToastStore } from "@/stores/toastStore";
import {
  storageService,
  StorageSettings,
  StorageUsage,
  UpdateStorageInput,
} from "@/api/services/storage.service";

export function useStorageSettings() {
  const { addToast } = useToastStore();

  const [settings, setSettings] = useState<StorageSettings | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      // Usage can fail independently (e.g. an unreachable custom bucket); do not
      // let it block showing the settings.
      const [s, u] = await Promise.allSettled([
        storageService.getSettings(),
        storageService.getUsage(),
      ]);
      if (s.status === "fulfilled") setSettings(s.value);
      if (u.status === "fulfilled") setUsage(u.value);
      if (s.status === "rejected") {
        addToast({ type: "error", title: "Failed to load storage settings" });
      }
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (input: UpdateStorageInput): Promise<boolean> => {
    setIsSaving(true);
    try {
      const updated = await storageService.updateSettings(input);
      setSettings(updated);
      addToast({
        type: "success",
        title: "Storage configured",
        description: "Your storage settings were verified and saved.",
      });
      // Refresh usage against the newly configured backend.
      void storageService.getUsage().then(setUsage).catch(() => {});
      return true;
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not save storage settings",
        description:
          err instanceof Error
            ? err.message
            : "The storage connection test failed.",
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const reset = async () => {
    setIsSaving(true);
    try {
      const updated = await storageService.clearSettings();
      setSettings(updated);
      addToast({
        type: "success",
        title: "Reverted to platform storage",
      });
      void storageService.getUsage().then(setUsage).catch(() => {});
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not reset storage settings",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const test = async () => {
    setIsTesting(true);
    try {
      const health = await storageService.testConnection();
      addToast({
        type: health.ok ? "success" : "error",
        title: health.ok
          ? `Storage reachable (${health.driver ?? "ok"})`
          : "Storage unreachable",
        description: health.ok ? undefined : health.error,
      });
    } catch (err) {
      addToast({
        type: "error",
        title: "Connection test failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return {
    settings,
    usage,
    isLoading,
    isSaving,
    isTesting,
    save,
    reset,
    test,
    reload: load,
  };
}

export default useStorageSettings;
