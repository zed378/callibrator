// src/app/dashboard/warehouse/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Warehouse } from "@/types";
import {
  Button,
  Input,
  Card,
  CardContent,
  Alert,
} from "@/components/ui";
import { Plus, Warehouse as WarehouseIcon } from "lucide-react";
import { useWarehouse } from "./hooks/useWarehouse";
import WarehouseModal from "./components/WarehouseModal";
import LocationsModal from "./components/LocationsModal";
import WarehouseTable from "./components/WarehouseTable";
import DeleteConfirmModal from "./components/DeleteConfirmModal";

export default function WarehousePage() {
  const {
    isLoading,
    error,
    searchTerm,
    setCurrentPage,
    setPageSize,
    isWarehouseModalOpen,
    setIsWarehouseModalOpen,
    warehouseModalType,
    selectedWarehouse,
    isLocationsModalOpen,
    setIsLocationsModalOpen,
    locationFormType,
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
    itemToDelete,
    warehouseForm,
    setWarehouseForm,
    locationForm,
    setLocationForm,
    hasWriteAccess,
    handleSearchChange,
    openCreateWarehouse,
    openEditWarehouse,
    handleWarehouseSubmit,
    confirmDeleteWarehouse,
    openLocationsManager,
    resetLocationForm,
    handleLocationSubmit,
    selectLocationForEdit,
    confirmDeleteLocation,
    handleDeleteConfirm,
    warehouseList,
    meta,
    locations,
  } = useWarehouse();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              Warehouse Management
            </h1>
<p className="text-muted-foreground mt-1">
               Configure inventory depots, storage sub-locations, and status levels.
             </p>
          </div>
          {hasWriteAccess && (
            <Button
              variant="primary"
              leftIcon={<Plus className="h-5 w-5" />}
              onClick={openCreateWarehouse}
            >
              Add Warehouse
            </Button>
          )}
        </div>

        <div className="flex gap-4">
          <div className="w-full max-w-sm">
            <Input
              type="text"
              placeholder="Search warehouses by name or code..."
              value={searchTerm}
              onChange={handleSearchChange}
            />
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {warehouseList.length > 0 ? (
          <WarehouseTable
            warehouseList={warehouseList}
            isLoading={isLoading}
            meta={meta}
            hasWriteAccess={hasWriteAccess}
            pageSize={meta.limit}
            setCurrentPage={setCurrentPage}
            setPageSize={setPageSize}
            openLocationsManager={openLocationsManager}
            openEditWarehouse={openEditWarehouse}
            confirmDeleteWarehouse={confirmDeleteWarehouse}
          />
        ) : (
          <Card>
            <CardContent className="p-16 text-center">
              <WarehouseIcon className="mx-auto h-16 w-16 text-muted-foreground" />
              <h3 className="text-xl font-semibold text-foreground mt-4">
                No Depots Configured
              </h3>
<p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                 Define your facility warehouses, rooms, or vehicles to enable inventory tracking.
               </p>
              {hasWriteAccess && (
                <Button
                  variant="primary"
                  leftIcon={<Plus className="h-5 w-5" />}
                  onClick={openCreateWarehouse}
                  className="mt-6"
                >
                  Create First Warehouse
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        <WarehouseModal
          isOpen={isWarehouseModalOpen}
          onClose={() => setIsWarehouseModalOpen(false)}
          modalType={warehouseModalType}
          hasWriteAccess={hasWriteAccess}
          form={warehouseForm}
          setForm={setWarehouseForm}
          onSubmit={handleWarehouseSubmit}
        />

        <LocationsModal
          isOpen={isLocationsModalOpen}
          onClose={() => setIsLocationsModalOpen(false)}
          selectedWarehouse={selectedWarehouse}
          locations={locations}
          hasWriteAccess={hasWriteAccess}
          locationFormType={locationFormType}
          locationForm={locationForm}
          setLocationForm={setLocationForm}
          onSubmitLocation={handleLocationSubmit}
          onEditLocationSelect={selectLocationForEdit}
          onDeleteLocationConfirm={confirmDeleteLocation}
          onCancelEditLocation={resetLocationForm}
        />

        <DeleteConfirmModal
          isOpen={isDeleteConfirmOpen}
          onClose={() => setIsDeleteConfirmOpen(false)}
          onConfirm={handleDeleteConfirm}
          type={itemToDelete?.type || ""}
        />
      </div>
    </DashboardLayout>
  );
}
