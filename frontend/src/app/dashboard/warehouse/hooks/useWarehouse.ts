// src/app/dashboard/warehouse/hooks/useWarehouse.ts
import { useEffect, useState } from "react";
import { useWarehouseStore } from "@/stores/warehouseStore";
import { useAuthStore } from "@/stores/authStore";
import { Warehouse, StorageLocation } from "@/types";

export function useWarehouse() {
  const { user } = useAuthStore();
  const {
    warehouses,
    locations,
    isLoading,
    error,
    fetchWarehouses,
    createWarehouse,
    updateWarehouse,
    deleteWarehouse,
    fetchLocations,
    createLocation,
    updateLocation,
    deleteLocation,
    setError,
  } = useWarehouseStore();

  // Search & Pagination State
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modal & Selection State
  const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
  const [warehouseModalType, setWarehouseModalType] = useState<"create" | "edit">("create");
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);

  const [isLocationsModalOpen, setIsLocationsModalOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<StorageLocation | null>(null);
  const [locationFormType, setLocationFormType] = useState<"create" | "edit">("create");

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: string; type: "warehouse" | "location" } | null>(null);

  // Forms State
  const [warehouseForm, setWarehouseForm] = useState({
    name: "",
    code: "",
    address: "",
    description: "",
    status: "active" as "active" | "suspended" | "inactive",
  });

  const [locationForm, setLocationForm] = useState({
    name: "",
    code: "",
    description: "",
    isActive: true,
  });

  // Check write access
  const hasWriteAccess =
    user?.role?.name === "SUPERADMIN" ||
    user?.role?.name === "HEALTHCARE ADMIN" ||
    user?.role?.name === "WAREHOUSE STAFF";

  // Fetch warehouses
  useEffect(() => {
    fetchWarehouses(currentPage, pageSize, searchTerm);
  }, [fetchWarehouses, currentPage, pageSize, searchTerm]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const openCreateWarehouse = () => {
    setWarehouseForm({
      name: "",
      code: "",
      address: "",
      description: "",
      status: "active",
    });
    setWarehouseModalType("create");
    setSelectedWarehouse(null);
    setIsWarehouseModalOpen(true);
  };

  const openEditWarehouse = (warehouse: Warehouse) => {
    setWarehouseForm({
      name: warehouse.name,
      code: warehouse.code,
      address: warehouse.address || "",
      description: warehouse.description || "",
      status: warehouse.status,
    });
    setWarehouseModalType("edit");
    setSelectedWarehouse(warehouse);
    setIsWarehouseModalOpen(true);
  };

  const handleWarehouseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (warehouseModalType === "create") {
        await createWarehouse(warehouseForm);
      } else if (warehouseModalType === "edit" && selectedWarehouse) {
        await updateWarehouse(selectedWarehouse.id, warehouseForm);
      }
      setIsWarehouseModalOpen(false);
      fetchWarehouses(currentPage, pageSize, searchTerm);
    } catch (err) {
      // Handled by store
    }
  };

  const confirmDeleteWarehouse = (id: string) => {
    setItemToDelete({ id, type: "warehouse" });
    setIsDeleteConfirmOpen(true);
  };

  const openLocationsManager = async (warehouse: Warehouse) => {
    setSelectedWarehouse(warehouse);
    await fetchLocations(warehouse.id);
    resetLocationForm();
    setIsLocationsModalOpen(true);
  };

  const resetLocationForm = () => {
    setLocationForm({
      name: "",
      code: "",
      description: "",
      isActive: true,
    });
    setLocationFormType("create");
    setSelectedLocation(null);
  };

  const handleLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWarehouse) return;
    setError(null);
    try {
      if (locationFormType === "create") {
        await createLocation({
          ...locationForm,
          warehouseId: selectedWarehouse.id,
        });
      } else if (locationFormType === "edit" && selectedLocation) {
        await updateLocation(selectedLocation.id, {
          name: locationForm.name,
          code: locationForm.code,
          description: locationForm.description,
          isActive: locationForm.isActive,
        });
      }
      resetLocationForm();
      fetchLocations(selectedWarehouse.id);
    } catch (err) {
      // Handled by store
    }
  };

  const selectLocationForEdit = (loc: StorageLocation) => {
    setSelectedLocation(loc);
    setLocationForm({
      name: loc.name,
      code: loc.code,
      description: loc.description || "",
      isActive: loc.isActive,
    });
    setLocationFormType("edit");
  };

  const confirmDeleteLocation = (id: string) => {
    setItemToDelete({ id, type: "location" });
    setIsDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    setError(null);
    try {
      if (itemToDelete.type === "warehouse") {
        await deleteWarehouse(itemToDelete.id);
        fetchWarehouses(currentPage, pageSize, searchTerm);
      } else if (itemToDelete.type === "location" && selectedWarehouse) {
        await deleteLocation(itemToDelete.id, selectedWarehouse.id);
        fetchLocations(selectedWarehouse.id);
      }
      setIsDeleteConfirmOpen(false);
      setItemToDelete(null);
    } catch (err) {
      // Handled by store
    }
  };

  const warehouseList = (warehouses?.data || []) as Warehouse[];
  const meta = warehouses?.meta || { total: 0, page: 1, limit: 10, totalPages: 1 };

  return {
    user,
    warehouses,
    locations,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    isWarehouseModalOpen,
    setIsWarehouseModalOpen,
    warehouseModalType,
    setWarehouseModalType,
    selectedWarehouse,
    setSelectedWarehouse,
    isLocationsModalOpen,
    setIsLocationsModalOpen,
    selectedLocation,
    setSelectedLocation,
    locationFormType,
    setLocationFormType,
    isDeleteConfirmOpen,
    setIsDeleteConfirmOpen,
    itemToDelete,
    setItemToDelete,
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
  };
}
export default useWarehouse;
