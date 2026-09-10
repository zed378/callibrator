import { create } from "zustand";
import {
  calibrationService,
  ApproveCertificateInput,
  Calibration,
  CalibrationCreateInput,
  CalibrationUpdateInput,
  Certificate,
  CertificateCreateInput,
  CertificateUpdateInput,
  RevokeCertificateInput,
  SignCertificateInput,
} from "@/api/services/calibration.service";
import { PaginatedResponse } from "@/types";

interface CertificateStats {
  totalCertificates: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  latestCertificate?: Certificate;
}

interface CalibrationState {
  calibrations: PaginatedResponse<Calibration> | null;
  certificates: PaginatedResponse<Certificate> | null;
  certificateStats: CertificateStats | null;
  currentCalibration: Calibration | null;
  currentCertificate: Certificate | null;
  isLoading: boolean;
  error: string | null;

  // Calibration actions
  fetchCalibrations: (
    page?: number,
    limit?: number,
    deviceId?: string,
    isCompliant?: boolean | null,
    from?: string,
    to?: string,
  ) => Promise<void>;
  fetchCalibrationById: (id: string) => Promise<void>;
  createCalibration: (data: CalibrationCreateInput) => Promise<Calibration>;
  updateCalibration: (data: CalibrationUpdateInput) => Promise<Calibration>;
  deleteCalibration: (id: string) => Promise<void>;

  // Certificate actions
  fetchCertificates: (
    page?: number,
    limit?: number,
    deviceId?: string,
    status?: string[],
    type?: string[],
    certificateNumber?: string,
    from?: string,
    to?: string,
  ) => Promise<void>;
  fetchCertificateById: (id: string) => Promise<void>;
  createCertificate: (data: CertificateCreateInput) => Promise<Certificate>;
  updateCertificate: (data: CertificateUpdateInput) => Promise<Certificate>;
  deleteCertificate: (id: string) => Promise<void>;
  approveCertificate: (
    id: string,
    input: ApproveCertificateInput,
  ) => Promise<Certificate>;
  signCertificate: (
    id: string,
    input: SignCertificateInput,
  ) => Promise<Certificate>;
  revokeCertificate: (
    id: string,
    input: RevokeCertificateInput,
  ) => Promise<Certificate>;
  fetchCertificateStats: () => Promise<void>;

  setError: (error: string | null) => void;
}

export const useCalibrationStore = create<CalibrationState>()((set) => ({
  calibrations: null,
  certificates: null,
  certificateStats: null,
  currentCalibration: null,
  currentCertificate: null,
  isLoading: false,
  error: null,

  fetchCalibrations: async (page = 1, limit = 10, deviceId, isCompliant, from, to) => {
    set({ isLoading: true, error: null });
    try {
      const calibrations = await calibrationService.getAll(
        page,
        limit,
        deviceId,
        isCompliant,
        from,
        to,
      );
      set({ calibrations, isLoading: false });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch calibration records";
      set({ isLoading: false, error: message });
    }
  },

  fetchCalibrationById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const currentCalibration = await calibrationService.getById(id);
      set({ currentCalibration, isLoading: false });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch calibration record";
      set({ isLoading: false, error: message });
    }
  },

  createCalibration: async (data: CalibrationCreateInput) => {
    set({ isLoading: true, error: null });
    try {
      const record = await calibrationService.create(data);
      set({ isLoading: false });
      return record;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create calibration record";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  updateCalibration: async (data: CalibrationUpdateInput) => {
    set({ isLoading: true, error: null });
    try {
      const record = await calibrationService.update(data);
      set({ currentCalibration: record, isLoading: false });
      return record;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to update calibration record";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  deleteCalibration: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await calibrationService.delete(id);
      set({ isLoading: false });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to delete calibration record";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  fetchCertificates: async (page = 1, limit = 10, deviceId, status, type, certificateNumber, from, to) => {
    set({ isLoading: true, error: null });
    try {
      const certificates = await calibrationService.getAllCertificates(
        page,
        limit,
        deviceId,
        status,
        type,
        certificateNumber,
        from,
        to,
      );
      set({ certificates, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch certificates";
      set({ isLoading: false, error: message });
    }
  },

  fetchCertificateById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const currentCertificate = await calibrationService.getCertificateById(id);
      set({ currentCertificate, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch certificate";
      set({ isLoading: false, error: message });
    }
  },

  createCertificate: async (data: CertificateCreateInput) => {
    set({ isLoading: true, error: null });
    try {
      const cert = await calibrationService.createCertificate(data);
      set({ isLoading: false });
      return cert;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create certificate";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  updateCertificate: async (data: CertificateUpdateInput) => {
    set({ isLoading: true, error: null });
    try {
      const cert = await calibrationService.updateCertificate(data);
      set({ currentCertificate: cert, isLoading: false });
      return cert;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update certificate";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  deleteCertificate: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await calibrationService.deleteCertificate(id);
      set({ isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete certificate";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  // These three carry 21 CFR Part 11 signing credentials (authMethod,
  // authPayload, meaning). The caller must collect them — re-authentication is
  // the point of the signature, so they cannot be defaulted here.
  approveCertificate: async (id: string, input: ApproveCertificateInput) => {
    set({ isLoading: true, error: null });
    try {
      const cert = await calibrationService.approveCertificate(id, input);
      set({ currentCertificate: cert, isLoading: false });
      return cert;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to approve certificate";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  signCertificate: async (id: string, input: SignCertificateInput) => {
    set({ isLoading: true, error: null });
    try {
      const cert = await calibrationService.signCertificate(id, input);
      set({ currentCertificate: cert, isLoading: false });
      return cert;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to sign certificate";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  revokeCertificate: async (id: string, input: RevokeCertificateInput) => {
    set({ isLoading: true, error: null });
    try {
      const cert = await calibrationService.revokeCertificate(id, input);
      set({ currentCertificate: cert, isLoading: false });
      return cert;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to revoke certificate";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  fetchCertificateStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const stats = await calibrationService.getCertificateStats();
      set({ certificateStats: stats, isLoading: false });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch certificate statistics";
      set({ isLoading: false, error: message });
    }
  },

  setError: (error) => set({ error }),
}));
