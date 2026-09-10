import { create } from "zustand";
import {
  tenantBackupService,
  BackupStats,
  PageMeta,
  TenantBackup,
} from "@/api/services/tenantBackup.service";

interface TenantBackupState {
  /** The rows themselves; pagination lives in `meta`. */
  backups: TenantBackup[];
  meta: PageMeta | null;
  currentBackup: TenantBackup | null;
  /** Mirrors the backend's real field names (completedBackups, numeric size). */
  stats: BackupStats | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  createBackup: (
    tenantId: string,
    data: {
      name: string;
      description?: string;
      backupType?: "FULL" | "PARTIAL" | "USER_ONLY";
      retentionDays?: number;
      tag?: string;
    },
  ) => Promise<TenantBackup>;
  fetchBackups: (
    tenantId: string,
    page?: number,
    limit?: number,
    status?: string,
  ) => Promise<void>;
  fetchBackupById: (tenantId: string, backupId: string) => Promise<void>;
  downloadBackup: (tenantId: string, backupId: string) => Promise<void>;
  restoreBackup: (
    tenantId: string,
    backupId: string,
    options?: {
      overwriteExisting?: boolean;
      restoreUsers?: boolean;
      restoreFeatures?: boolean;
    },
  ) => Promise<{ success: boolean; message: string }>;
  deleteBackup: (tenantId: string, backupId: string) => Promise<void>;
  fetchStats: (tenantId: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useTenantBackupStore = create<TenantBackupState>()((set) => ({
  backups: [],
  meta: null,
  currentBackup: null,
  stats: null,
  isLoading: false,
  error: null,

  createBackup: async (tenantId: string, data) => {
    set({ isLoading: true, error: null });
    try {
      const backup = await tenantBackupService.create(tenantId, data);
      set({ currentBackup: backup, isLoading: false, error: null });
      return backup;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create backup";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  fetchBackups: async (
    tenantId: string,
    page = 1,
    limit = 20,
    status?: string,
  ) => {
    set({ isLoading: true, error: null });
    try {
      // getAll returns { data, meta } — assigning the whole object into
      // `backups` (a list) left the store holding a non-array.
      const { data, meta } = await tenantBackupService.getAll(
        tenantId,
        page,
        limit,
        status,
      );
      set({ backups: data, meta, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch backups";
      set({ isLoading: false, error: message });
    }
  },

  fetchBackupById: async (tenantId: string, backupId: string) => {
    set({ isLoading: true, error: null });
    try {
      const backup = await tenantBackupService.getById(tenantId, backupId);
      set({ currentBackup: backup, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch backup";
      set({ isLoading: false, error: message });
    }
  },

  downloadBackup: async (tenantId: string, backupId: string) => {
    set({ isLoading: true, error: null });
    try {
      // download() only returns the blob; downloadToDisk actually saves it.
      await tenantBackupService.downloadToDisk(tenantId, backupId);
      set({ isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to download backup";
      set({ isLoading: false, error: message });
    }
  },

  restoreBackup: async (tenantId: string, backupId: string, options?) => {
    set({ isLoading: true, error: null });
    try {
      const result = await tenantBackupService.restore(
        tenantId,
        backupId,
        options,
      );
      set({ isLoading: false, error: null });
      return result;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to restore backup";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  deleteBackup: async (tenantId: string, backupId: string) => {
    set({ isLoading: true, error: null });
    try {
      await tenantBackupService.delete(tenantId, backupId);
      set({ isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete backup";
      set({ isLoading: false, error: message });
    }
  },

  fetchStats: async (tenantId: string) => {
    set({ isLoading: true, error: null });
    try {
      const stats = await tenantBackupService.getStats(tenantId);
      set({ stats, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch backup stats";
      set({ isLoading: false, error: message });
    }
  },

  setError: (error) => set({ error }),
}));
