"use client";

import React from "react";
import Link from "next/link";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Alert } from "@/components/ui";
import { CalendarCheck, Plus } from "lucide-react";
import { useCalibration } from "./hooks/useCalibration";
import CalibrationStats from "./components/CalibrationStats";
import {
  RecordsFilterCard,
  CertificatesFilterCard,
} from "./components/CalibrationFilters";
import CalibrationRecordsTable from "./components/CalibrationRecordsTable";
import CertificatesTable from "./components/CertificatesTable";
import RecordCalibrationModal from "./components/RecordCalibrationModal";
import CreateCertModal from "./components/CreateCertModal";
import SignCertModal from "./components/SignCertModal";
import RevokeCertModal from "./components/RevokeCertModal";
import ApproveCertModal from "./components/ApproveCertModal";

export default function CalibrationPage() {
  const {
    calibrations,
    certificates,
    certificateStats,
    isCalibLoading,
    calibError,
    recordsList,
    certificatesList,
    statsList,
    activeTab,
    setActiveTab,
    setCalibPage,
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
    selectedCertToSign,
    selectedCertToRevoke,
    selectedCertToApprove,
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
    user,
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
  } = useCalibration();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Compliance & Quality Control
            </h1>
            <p className="text-sm text-muted-foreground">
              Schedule validations, record verification metrics, and generate
              digital certificates.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* P22-05: an outside laboratory's date by the device's QR sticker, and the latest per device. */}
            <Link
              href="/dashboard/calibration-dates"
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              Calibration dates
            </Link>
            {canWriteRecords && (
              <Button
                onClick={() => setIsRecordModalOpen(true)}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Record Calibration
              </Button>
            )}
          </div>
        </div>

        {calibError && <Alert variant="error">{calibError}</Alert>}
        {/* F-19: each list reports its own failed read. */}
        {statsList.error && (
          <Alert variant="error">{statsList.error}</Alert>
        )}

        <CalibrationStats stats={certificateStats} />

        <div className="flex border-b border-border">
          {(["records", "certificates"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-2.5 px-4 font-semibold text-sm border-b-2 transition-all ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "records"
                ? "Calibration Records"
                : "Compliance Certificates"}
            </button>
          ))}
        </div>

        {activeTab === "records" ? (
          <div className="space-y-4">
            <RecordsFilterCard
              selectedDeviceFilter={selectedDeviceFilter}
              setSelectedDeviceFilter={setSelectedDeviceFilter}
              complianceFilter={complianceFilter}
              setComplianceFilter={setComplianceFilter}
              devices={devices}
              setCalibPage={setCalibPage}
            />

            {recordsList.error && (
              <Alert variant="error">{recordsList.error}</Alert>
            )}
            <CalibrationRecordsTable
              calibrations={calibrations}
              isCalibLoading={recordsList.isLoading}
              pageSize={pageSize}
              onPageChange={setCalibPage}
              hasWriteAccess={canWriteCertificates}
              openCreateCertificateModal={openCreateCertificateModal}
              loadFailed={!!recordsList.error && !calibrations}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <CertificatesFilterCard
              certNumFilter={certNumFilter}
              setCertNumFilter={setCertNumFilter}
              certStatusFilter={certStatusFilter}
              setCertStatusFilter={setCertStatusFilter}
              setCertPage={setCertPage}
            />

            {certificatesList.error && (
              <Alert variant="error">{certificatesList.error}</Alert>
            )}
            <CertificatesTable
              certificates={certificates}
              isCalibLoading={certificatesList.isLoading}
              pageSize={pageSize}
              onPageChange={setCertPage}
              hasWriteAccess={canWriteCertificates}
              currentUserId={user?.id}
              onSubmitCertificate={handleSubmitCertificate}
              openApproveModal={openApproveModal}
              openSignModal={openSignModal}
              openRevokeModal={openRevokeModal}
            />
          </div>
        )}

        <RecordCalibrationModal
          isOpen={isRecordModalOpen}
          onClose={() => setIsRecordModalOpen(false)}
          onSubmit={handleRecordSubmit}
          devices={devices}
          form={recordForm}
          setForm={setRecordForm}
          isLoading={isCalibLoading}
        />

        <CreateCertModal
          isOpen={isCertModalOpen}
          onClose={() => setIsCertModalOpen(false)}
          onSubmit={handleCertSubmit}
          selectedRecordForCert={selectedRecordForCert}
          form={certForm}
          setForm={setCertForm}
          isLoading={isCalibLoading}
        />

        <ApproveCertModal
          isOpen={isApproveModalOpen}
          onClose={() => setIsApproveModalOpen(false)}
          onSubmit={handleApproveSubmit}
          selectedCertToApprove={selectedCertToApprove}
          error={calibError}
          form={approveForm}
          setForm={setApproveForm}
          isLoading={isCalibLoading}
        />

        <SignCertModal
          isOpen={isSignModalOpen}
          onClose={() => setIsSignModalOpen(false)}
          onSubmit={handleSignSubmit}
          selectedCertToSign={selectedCertToSign}
          form={signForm}
          setForm={setSignForm}
          isLoading={isCalibLoading}
        />

        <RevokeCertModal
          isOpen={isRevokeModalOpen}
          onClose={() => setIsRevokeModalOpen(false)}
          onSubmit={handleRevokeSubmit}
          selectedCertToRevoke={selectedCertToRevoke}
          form={revokeForm}
          setForm={setRevokeForm}
          isLoading={isCalibLoading}
        />
      </div>
    </DashboardLayout>
  );
}
