// src/app/dashboard/devices/page.tsx
"use client";

import React, { useRef } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Button,
  Input,
  Select,
  Card,
  CardContent,
  Alert,
} from "@/components/ui";
import { Plus, Search, Upload } from "lucide-react";
import { useDevices } from "./hooks/useDevices";
import DeviceModal from "./components/DeviceModal";
import DeleteDeviceModal from "./components/DeleteDeviceModal";
import DevicesTable from "./components/DevicesTable";

export default function DevicesPage() {
  const {
    devices,
    isDevicesLoading,
    devicesError,
    warehouses,
    searchTerm,
    statusFilter,
    categoryFilter,
    setCurrentPage,
    pageSize,
    isDeviceModalOpen,
    setIsDeviceModalOpen,
    modalType,
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
    form,
    setForm,
    hasWriteAccess,
    handleSearchChange,
    handleStatusChange,
    handleCategoryChange,
    openCreateModal,
    openEditModal,
    handleFormSubmit,
    handleDeleteClick,
    confirmDelete,
    isImporting,
    importResult,
    handleImportFile,
    clearImportResult,
  } = useDevices();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const onImportFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImportFile(file);
    e.target.value = "";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Calibration Devices
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage medical instrumentation and calibration equipment.
            </p>
          </div>
          {hasWriteAccess && (
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={onImportFileSelected}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                {isImporting ? "Importing..." : "Import CSV"}
              </Button>
              <Button
                onClick={openCreateModal}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Device
              </Button>
            </div>
          )}
        </div>

        {devicesError && <Alert variant="error">{devicesError}</Alert>}

        {importResult && (
          <Alert
            variant={importResult.failedCount > 0 ? "warning" : "success"}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p>
                  CSV import finished: {importResult.successCount} of{" "}
                  {importResult.totalCount} device(s) imported
                  {importResult.failedCount > 0 &&
                    `, ${importResult.failedCount} failed`}
                  .
                </p>
                {importResult.errors?.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {importResult.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>
                        Row {err.row}: {err.errors}
                      </li>
                    ))}
                    {importResult.errors.length > 5 && (
                      <li>…and {importResult.errors.length - 5} more</li>
                    )}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={clearImportResult}
                className="text-sm underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          </Alert>
        )}

        {/* Filters */}
        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, serial number, manufacturer..."
                  value={searchTerm}
                  onChange={handleSearchChange}
                  className="pl-9"
                />
              </div>

              <div>
                <Input
                  placeholder="Filter by category (e.g. Temperature)"
                  value={categoryFilter}
                  onChange={handleCategoryChange}
                />
              </div>

              <div>
                <Select
                  value={statusFilter}
                  onChange={handleStatusChange}
                  options={[
                    { value: "", label: "All Statuses" },
                    { value: "active", label: "Active" },
                    { value: "inactive", label: "Inactive" },
                    { value: "maintenance", label: "Maintenance" },
                    { value: "retired", label: "Retired" },
                  ]}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Devices Table */}
        <DevicesTable
          devices={devices}
          isDevicesLoading={isDevicesLoading}
          pageSize={pageSize}
          setCurrentPage={setCurrentPage}
          hasWriteAccess={hasWriteAccess}
          openEditModal={openEditModal}
          handleDeleteClick={handleDeleteClick}
        />

        <DeviceModal
          isOpen={isDeviceModalOpen}
          onClose={() => setIsDeviceModalOpen(false)}
          modalType={modalType}
          isLoading={isDevicesLoading}
          form={form}
          setForm={setForm}
          warehousesData={warehouses?.data || []}
          onSubmit={handleFormSubmit}
        />

        <DeleteDeviceModal
          isOpen={isDeleteConfirmOpen}
          onClose={() => setIsDeleteConfirmOpen(false)}
          onConfirm={confirmDelete}
          isLoading={isDevicesLoading}
        />
      </div>
    </DashboardLayout>
  );
}
