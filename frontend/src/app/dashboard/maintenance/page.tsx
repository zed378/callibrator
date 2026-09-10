// src/app/dashboard/maintenance/page.tsx
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
import { useMaintenance } from "./hooks/useMaintenance";
import WorkOrderModal from "./components/WorkOrderModal";
import DeleteWorkOrderModal from "./components/DeleteWorkOrderModal";
import WorkOrdersTable from "./components/WorkOrdersTable";

export default function MaintenancePage() {
  const {
    workOrders,
    isWorkOrdersLoading,
    workOrdersError,
    isSubmitting,
    devices,
    vendors,
    searchTerm,
    statusFilter,
    priorityFilter,
    typeFilter,
    setCurrentPage,
    pageSize,
    isWorkOrderModalOpen,
    setIsWorkOrderModalOpen,
    modalType,
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
    form,
    setForm,
    hasWriteAccess,
    handleSearchChange,
    handleStatusChange,
    handlePriorityChange,
    handleTypeChange,
    openCreateModal,
    openEditModal,
    handleFormSubmit,
    handleDeleteClick,
    confirmDelete,
  } = useMaintenance();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Maintenance Work Orders
            </h1>
            <p className="text-sm text-muted-foreground">
              Track preventative maintenance, breakdowns, and repairs.
            </p>
          </div>
          {hasWriteAccess && (
            <Button
              onClick={openCreateModal}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              New Work Order
            </Button>
          )}
        </div>

        {workOrdersError && <Alert variant="error">{workOrdersError}</Alert>}

        {/* Filters */}
        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search title or description..."
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
                    { value: "Open", label: "Open" },
                    { value: "InProgress", label: "In Progress" },
                    { value: "Completed", label: "Completed" },
                    { value: "Cancelled", label: "Cancelled" },
                  ]}
                />
              </div>

              <div>
                <Select
                  value={priorityFilter}
                  onChange={handlePriorityChange}
                  options={[
                    { value: "", label: "All Priorities" },
                    { value: "Low", label: "Low" },
                    { value: "Medium", label: "Medium" },
                    { value: "High", label: "High" },
                    { value: "Critical", label: "Critical" },
                  ]}
                />
              </div>

              <div>
                <Select
                  value={typeFilter}
                  onChange={handleTypeChange}
                  options={[
                    { value: "", label: "All Types" },
                    { value: "Preventative", label: "Preventative" },
                    { value: "Breakdown", label: "Breakdown" },
                    { value: "Repair", label: "Repair" },
                  ]}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Work Orders Table */}
        <WorkOrdersTable
          workOrders={workOrders}
          isWorkOrdersLoading={isWorkOrdersLoading}
          pageSize={pageSize}
          setCurrentPage={setCurrentPage}
          hasWriteAccess={hasWriteAccess}
          openEditModal={openEditModal}
          handleDeleteClick={handleDeleteClick}
        />

        <WorkOrderModal
          isOpen={isWorkOrderModalOpen}
          onClose={() => setIsWorkOrderModalOpen(false)}
          modalType={modalType}
          isLoading={isSubmitting}
          form={form}
          setForm={setForm}
          devices={devices}
          vendors={vendors}
          onSubmit={handleFormSubmit}
        />

        <DeleteWorkOrderModal
          isOpen={isDeleteConfirmOpen}
          onClose={() => setIsDeleteConfirmOpen(false)}
          onConfirm={confirmDelete}
          isLoading={isSubmitting}
        />
      </div>
    </DashboardLayout>
  );
}
