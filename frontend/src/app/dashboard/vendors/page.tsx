// src/app/dashboard/vendors/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Button,
  Input,
  Select,
  Card,
  CardContent,
  Alert,
} from "@/components/ui";
import { Plus, Search } from "lucide-react";
import { useVendors } from "./hooks/useVendors";
import VendorModal from "./components/VendorModal";
import DeleteVendorModal from "./components/DeleteVendorModal";
import VendorsTable from "./components/VendorsTable";

export default function VendorsPage() {
  const {
    vendors,
    isVendorsLoading,
    vendorsError,
    isSubmitting,
    searchTerm,
    statusFilter,
    typeFilter,
    setCurrentPage,
    pageSize,
    isVendorModalOpen,
    setIsVendorModalOpen,
    modalType,
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
    form,
    setForm,
    hasWriteAccess,
    handleSearchChange,
    handleStatusChange,
    handleTypeChange,
    openCreateModal,
    openEditModal,
    handleFormSubmit,
    handleDeleteClick,
    handleQualify,
    confirmDelete,
  } = useVendors();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Vendors</h1>
            <p className="text-sm text-muted-foreground">
              Manage calibration labs, parts suppliers, and service partners.
            </p>
          </div>
          {hasWriteAccess && (
            <Button
              onClick={openCreateModal}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Vendor
            </Button>
          )}
        </div>

        {vendorsError && <Alert variant="error">{vendorsError}</Alert>}

        {/* Filters */}
        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, contact person, email..."
                  value={searchTerm}
                  onChange={handleSearchChange}
                  className="pl-9"
                />
              </div>

              <div>
                <Select
                  value={statusFilter}
                  onChange={handleStatusChange}
                  options={[
                    { value: "", label: "All Statuses" },
                    { value: "Active", label: "Active" },
                    { value: "Inactive", label: "Inactive" },
                  ]}
                />
              </div>

              <div>
                <Select
                  value={typeFilter}
                  onChange={handleTypeChange}
                  options={[
                    { value: "", label: "All Types" },
                    { value: "CalibrationLab", label: "Calibration Lab" },
                    { value: "PartsSupplier", label: "Parts Supplier" },
                    { value: "Other", label: "Other" },
                  ]}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Vendors Table */}
        <VendorsTable
          vendors={vendors}
          isVendorsLoading={isVendorsLoading}
          pageSize={pageSize}
          setCurrentPage={setCurrentPage}
          hasWriteAccess={hasWriteAccess}
          openEditModal={openEditModal}
          handleDeleteClick={handleDeleteClick}
          handleQualify={handleQualify}
        />

        <VendorModal
          isOpen={isVendorModalOpen}
          onClose={() => setIsVendorModalOpen(false)}
          modalType={modalType}
          isLoading={isSubmitting}
          form={form}
          setForm={setForm}
          onSubmit={handleFormSubmit}
        />

        <DeleteVendorModal
          isOpen={isDeleteConfirmOpen}
          onClose={() => setIsDeleteConfirmOpen(false)}
          onConfirm={confirmDelete}
          isLoading={isSubmitting}
        />
      </div>
    </DashboardLayout>
  );
}
