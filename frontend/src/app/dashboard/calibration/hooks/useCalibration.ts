// src/app/dashboard/calibration/hooks/useCalibration.ts
import React, { useEffect, useState } from "react";
import { useCalibrationStore } from "@/stores/calibrationStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useAuthStore } from "@/stores/authStore";
import { Calibration, Certificate } from "@/api/services/calibration.service";
import { usePermissions } from "@/hooks/usePermissions";
import { useSearchHandoff } from "@/stores/searchHandoffStore";

/** The "record calibration" form (RecordCalibrationModal). */
export interface RecordCalibrationForm {
  deviceId: string;
  calibrationDate: string;
  dueDate: string;
  standard: string;
  results: {
    temperatureReading: string;
    humidityReading: string;
    deviation: string;
  };
  isCompliant: boolean;
  notes: string;
}

/** The "create certificate" form (CreateCertModal). */
export interface CreateCertificateForm {
  deviceId: string;
  calibrationRecordId: string;
  type: "calibration" | "maintenance" | "verification";
  summary: string;
  conditions: string;
  notes: string;
  standard: string;
  validUntil: string;
}

export function useCalibration() {
  const { user } = useAuthStore();
  const {
    calibrations,
    certificates,
    certificateStats,
    isLoading: isCalibLoading,
    error: calibError,
    lists,
    fetchCalibrations,
    createCalibration,
    fetchCertificates,
    createCertificate,
    submitCertificate,
    approveCertificate,
    signCertificate,
    revokeCertificate,
    fetchCertificateStats,
    setError,
  } = useCalibrationStore();

  const { devices, fetchDevices } = useDeviceStore();

  // Navigation tabs
  // S6: a certificate chosen in the global search opens the certificates tab
  // filtered to its number. Taken once, at mount.
  const handedCertificate = useSearchHandoff("certificate");
  const [activeTab, setActiveTab] = useState<"records" | "certificates">(
    handedCertificate ? "certificates" : "records",
  );

  // Pagination states
  const [calibPage, setCalibPage] = useState(1);
  const [certPage, setCertPage] = useState(1);
  const [pageSize] = useState(10);

  // Filter states
  const [selectedDeviceFilter, setSelectedDeviceFilter] = useState("");
  const [complianceFilter, setComplianceFilter] = useState<boolean | null>(
    null,
  );

  const [certStatusFilter, setCertStatusFilter] = useState<string[]>([]);
  const [certNumFilter, setCertNumFilter] = useState(handedCertificate ?? "");

  // Modals state
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [isCertModalOpen, setIsCertModalOpen] = useState(false);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);

  const [selectedRecordForCert, setSelectedRecordForCert] =
    useState<Calibration | null>(null);
  const [selectedCertToSign, setSelectedCertToSign] =
    useState<Certificate | null>(null);
  const [selectedCertToRevoke, setSelectedCertToRevoke] =
    useState<Certificate | null>(null);
  const [selectedCertToApprove, setSelectedCertToApprove] =
    useState<Certificate | null>(null);

  // Forms State
  const [recordForm, setRecordForm] = useState<RecordCalibrationForm>({
    deviceId: "",
    calibrationDate: "",
    dueDate: "",
    standard: "ISO 17025",
    results: {
      temperatureReading: "",
      humidityReading: "",
      deviation: "",
    },
    isCompliant: true,
    notes: "",
  });

  const [certForm, setCertForm] = useState<CreateCertificateForm>({
    deviceId: "",
    calibrationRecordId: "",
    type: "calibration",
    summary: "",
    conditions: "Standard indoor laboratory conditions.",
    notes: "",
    standard: "ISO 17025",
    validUntil: "",
  });

  // 21 CFR Part 11: approve/sign/revoke each require the signer to
  // re-authenticate (authMethod + authPayload) and state the meaning of the
  // signature. The backend rejects any of these three being absent.
  const [signForm, setSignForm] = useState({
    digitalSignature: "",
    digitalSignatureKeyId: "key-hsm-prov-001",
    authMethod: "password" as "password" | "mfa",
    authPayload: "",
    meaning: "Reviewed and signed",
  });

  const [revokeForm, setRevokeForm] = useState({
    reason: "",
    authMethod: "password" as "password" | "mfa",
    authPayload: "",
    meaning: "Revoked",
  });

  const [approveForm, setApproveForm] = useState({
    authMethod: "password" as "password" | "mfa",
    authPayload: "",
    meaning: "Reviewed and approved",
  });

  // ADR-102: from the effective permission the API checks, never role names.
  // Recording a calibration is gated on `calibration` write
  // (calibrationRecords.route.js); every certificate write — create, submit,
  // approve, sign, revoke — on `certificate` write (certificates.route.js).
  const { canWrite } = usePermissions();
  const canWriteRecords = canWrite("calibration");
  const canWriteCertificates = canWrite("certificate");

  // Initial Loads
  useEffect(() => {
    fetchDevices(1, 100);
    fetchCertificateStats();
  }, [fetchDevices, fetchCertificateStats]);

  // Load Calibrations
  useEffect(() => {
    fetchCalibrations(
      calibPage,
      pageSize,
      selectedDeviceFilter || undefined,
      complianceFilter,
    );
  }, [
    fetchCalibrations,
    calibPage,
    pageSize,
    selectedDeviceFilter,
    complianceFilter,
  ]);

  // Load Certificates
  useEffect(() => {
    fetchCertificates(
      certPage,
      pageSize,
      undefined,
      certStatusFilter.length > 0 ? certStatusFilter : undefined,
      undefined,
      certNumFilter || undefined,
    );
  }, [fetchCertificates, certPage, pageSize, certStatusFilter, certNumFilter]);

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createCalibration({
        ...recordForm,
        results: {
          ...recordForm.results,
          deviation: Number(recordForm.results.deviation) || 0,
        },
      });
      setIsRecordModalOpen(false);
      fetchCalibrations(
        calibPage,
        pageSize,
        selectedDeviceFilter || undefined,
        complianceFilter,
      );
      fetchCertificateStats();
    } catch (err) {
      // Handled by store
    }
  };

  const openCreateCertificateModal = (record: Calibration) => {
    setSelectedRecordForCert(record);
    const validDate = new Date(record.calibrationDate);
    validDate.setFullYear(validDate.getFullYear() + 1); // 1 year validity default

    setCertForm({
      deviceId: record.deviceId,
      calibrationRecordId: record.id,
      type: "calibration",
      summary: `Successful compliance calibration performed on ${new Date(record.calibrationDate).toLocaleDateString()}. Device is fully operational and within limits.`,
      conditions:
        "Tested in temperature-regulated lab room (22°C ±2°C, humidity 45% ±5%).",
      notes: record.notes || "",
      standard: record.standard || "ISO 17025",
      validUntil: validDate.toISOString().substring(0, 10),
    });
    setIsCertModalOpen(true);
  };

  const handleCertSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createCertificate(certForm);
      setIsCertModalOpen(false);
      fetchCertificates(
        certPage,
        pageSize,
        undefined,
        certStatusFilter.length > 0 ? certStatusFilter : undefined,
        undefined,
        certNumFilter || undefined,
      );
      fetchCertificateStats();
    } catch (err) {
      // Handled by store
    }
  };

  const refetchCertificates = () => {
    fetchCertificates(
      certPage,
      pageSize,
      undefined,
      certStatusFilter.length > 0 ? certStatusFilter : undefined,
      undefined,
      certNumFilter || undefined,
    );
    fetchCertificateStats();
  };

  // draft → pending_approval. Not a signature, so no modal; a refusal (409,
  // e.g. it was submitted meanwhile) is shown as the backend explains it.
  const handleSubmitCertificate = async (cert: Certificate) => {
    setError(null);
    try {
      await submitCertificate(cert.id);
      refetchCertificates();
    } catch (err) {
      // Handled by store (the explanation is shown in the page alert)
    }
  };

  // Approving is a signed act: it opens a modal to collect credentials rather
  // than firing straight from the row.
  const openApproveModal = (cert: Certificate) => {
    // The dialog shows the store's error (a refusal of THIS approval) — clear
    // any earlier one first.
    setError(null);
    setSelectedCertToApprove(cert);
    setApproveForm({
      authMethod: "password",
      authPayload: "",
      meaning: "Reviewed and approved",
    });
    setIsApproveModalOpen(true);
  };

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCertToApprove) return;
    if (!user?.id) {
      setError("You must be signed in to approve a certificate");
      return;
    }
    if (!approveForm.authPayload) {
      setError("Enter your password to sign this approval");
      return;
    }
    setError(null);
    try {
      await approveCertificate(selectedCertToApprove.id, {
        approvedBy: user.id,
        authMethod: approveForm.authMethod,
        authPayload: approveForm.authPayload,
        meaning: approveForm.meaning,
      });
      setIsApproveModalOpen(false);
      setSelectedCertToApprove(null);
      // Never leave the credential in memory after the request.
      setApproveForm((f) => ({ ...f, authPayload: "" }));
      fetchCertificates(
        certPage,
        pageSize,
        undefined,
        certStatusFilter.length > 0 ? certStatusFilter : undefined,
        undefined,
        certNumFilter || undefined,
      );
      fetchCertificateStats();
    } catch (err) {
      // Handled by store
    }
  };

  const openSignModal = (cert: Certificate) => {
    setSelectedCertToSign(cert);
    setSignForm({
      digitalSignature: `SHA256withRSA:${Buffer.from(`${cert.id}-${user?.id}-${Date.now()}`).toString("base64").substring(0, 32)}`,
      digitalSignatureKeyId: "key-hsm-prov-001",
      authMethod: "password",
      authPayload: "",
      meaning: "Reviewed and signed",
    });
    setIsSignModalOpen(true);
  };

  const handleSignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCertToSign) return;
    if (!signForm.authPayload) {
      setError("Enter your password to sign this certificate");
      return;
    }
    setError(null);
    try {
      await signCertificate(selectedCertToSign.id, {
        digitalSignature: signForm.digitalSignature,
        digitalSignatureKeyId: signForm.digitalSignatureKeyId,
        authMethod: signForm.authMethod,
        authPayload: signForm.authPayload,
        meaning: signForm.meaning,
      });
      setIsSignModalOpen(false);
      setSelectedCertToSign(null);
      setSignForm((f) => ({ ...f, authPayload: "" }));
      fetchCertificates(
        certPage,
        pageSize,
        undefined,
        certStatusFilter.length > 0 ? certStatusFilter : undefined,
        undefined,
        certNumFilter || undefined,
      );
      fetchCertificateStats();
    } catch (err) {
      // Handled by store
    }
  };

  const openRevokeModal = (cert: Certificate) => {
    setSelectedCertToRevoke(cert);
    setRevokeForm({
      reason: "",
      authMethod: "password",
      authPayload: "",
      meaning: "Revoked",
    });
    setIsRevokeModalOpen(true);
  };

  const handleRevokeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCertToRevoke) return;
    if (!revokeForm.reason.trim()) {
      setError("A revocation reason is required");
      return;
    }
    if (!revokeForm.authPayload) {
      setError("Enter your password to sign this revocation");
      return;
    }
    setError(null);
    try {
      await revokeCertificate(selectedCertToRevoke.id, {
        reason: revokeForm.reason,
        authMethod: revokeForm.authMethod,
        authPayload: revokeForm.authPayload,
        meaning: revokeForm.meaning,
      });
      setIsRevokeModalOpen(false);
      setSelectedCertToRevoke(null);
      setRevokeForm((f) => ({ ...f, authPayload: "" }));
      fetchCertificates(
        certPage,
        pageSize,
        undefined,
        certStatusFilter.length > 0 ? certStatusFilter : undefined,
        undefined,
        certNumFilter || undefined,
      );
      fetchCertificateStats();
    } catch (err) {
      // Handled by store
    }
  };

  return {
    user,
    calibrations,
    certificates,
    certificateStats,
    isCalibLoading,
    calibError,
    // F-19: each list's own read state (calibrationStore.lists).
    recordsList: lists.calibrations,
    certificatesList: lists.certificates,
    statsList: lists.certificateStats,
    activeTab,
    setActiveTab,
    calibPage,
    setCalibPage,
    certPage,
    setCertPage,
    pageSize,
    selectedDeviceFilter,
    setSelectedDeviceFilter,
    complianceFilter,
    setComplianceFilter,
    certStatusFilter,
    setCertStatusFilter,
    certNumFilter,
    setCertNumFilter,
    isRecordModalOpen,
    setIsRecordModalOpen,
    isCertModalOpen,
    setIsCertModalOpen,
    isSignModalOpen,
    setIsSignModalOpen,
    isRevokeModalOpen,
    setIsRevokeModalOpen,
    isApproveModalOpen,
    setIsApproveModalOpen,
    selectedRecordForCert,
    setSelectedRecordForCert,
    selectedCertToSign,
    setSelectedCertToSign,
    selectedCertToRevoke,
    setSelectedCertToRevoke,
    selectedCertToApprove,
    setSelectedCertToApprove,
    recordForm,
    setRecordForm,
    certForm,
    setCertForm,
    signForm,
    setSignForm,
    revokeForm,
    setRevokeForm,
    approveForm,
    setApproveForm,
    canWriteRecords,
    canWriteCertificates,
    handleSubmitCertificate,
    handleRecordSubmit,
    openCreateCertificateModal,
    handleCertSubmit,
    openApproveModal,
    handleApproveSubmit,
    openSignModal,
    handleSignSubmit,
    openRevokeModal,
    handleRevokeSubmit,
    devices,
  };
}

export default useCalibration;
