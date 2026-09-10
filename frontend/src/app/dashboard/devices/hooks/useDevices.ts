// src/app/dashboard/devices/hooks/useDevices.ts
import { useEffect, useState } from "react";
import { useDeviceStore } from "@/stores/deviceStore";
import { useWarehouseStore } from "@/stores/warehouseStore";
import { useAuthStore } from "@/stores/authStore";
import {
  Device,
  DeviceCreateInput,
  BulkImportResult,
  deviceService,
} from "@/api/services/device.service";

export function useDevices() {
  const { user } = useAuthStore();
  const {
    devices,
    isLoading: isDevicesLoading,
    error: devicesError,
    fetchDevices,
    createDevice,
    updateDevice,
    deleteDevice,
    setError,
  } = useDeviceStore();

  const {
    warehouses,
    fetchWarehouses,
  } = useWarehouseStore();

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

  // Modal State
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"create" | "edit">("create");
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState<string | null>(null);

  // Bulk CSV import state
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(
    null,
  );

  // Form State
  const [form, setForm] = useState<Omit<DeviceCreateInput, "id">>({
    name: "",
    serialNumber: "",
    manufacturer: "",
    model: "",
    category: "",
    status: "active",
    locationId: "",
    installationDate: "",
    nextCalibrationDate: "",
    calibrationIntervalDays: 180,
    remarks: "",
  });

  // User Permissions check
  const hasWriteAccess =
    user?.role?.name === "SUPERADMIN" ||
    user?.role?.name === "HEALTHCARE ADMIN" ||
    user?.role?.name === "WAREHOUSE STAFF";

  // Initial loads
  useEffect(() => {
    fetchWarehouses(1, 100);
  }, [fetchWarehouses]);

  // Load devices on change of page, search, filters
  useEffect(() => {
    fetchDevices(currentPage, pageSize, searchTerm || undefined, statusFilter || undefined, categoryFilter || undefined);
  }, [fetchDevices, currentPage, pageSize, searchTerm, statusFilter, categoryFilter]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCategoryFilter(e.target.value);
    setCurrentPage(1);
  };

  const openCreateModal = () => {
    setForm({
      name: "",
      serialNumber: "",
      manufacturer: "",
      model: "",
      category: "",
      status: "active",
      locationId: "",
      installationDate: "",
      nextCalibrationDate: "",
      calibrationIntervalDays: 180,
      remarks: "",
    });
    setModalType("create");
    setSelectedDevice(null);
    setIsDeviceModalOpen(true);
  };

  const openEditModal = (device: Device) => {
    setForm({
      name: device.name,
      serialNumber: device.serialNumber || "",
      manufacturer: device.manufacturer || "",
      model: device.model || "",
      category: device.category || "",
      status: device.status,
      locationId: device.locationId || "",
      installationDate: device.installationDate ? device.installationDate.substring(0, 10) : "",
      nextCalibrationDate: device.nextCalibrationDate ? device.nextCalibrationDate.substring(0, 10) : "",
      calibrationIntervalDays: device.calibrationIntervalDays || 180,
      remarks: device.remarks || "",
    });
    setModalType("edit");
    setSelectedDevice(device);
    setIsDeviceModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        ...form,
        locationId: form.locationId || undefined,
        installationDate: form.installationDate || undefined,
        nextCalibrationDate: form.nextCalibrationDate || undefined,
        calibrationIntervalDays: form.calibrationIntervalDays ? Number(form.calibrationIntervalDays) : undefined,
      };

      if (modalType === "create") {
        await createDevice(payload);
      } else if (modalType === "edit" && selectedDevice) {
        await updateDevice({
          ...payload,
          id: selectedDevice.id,
        });
      }
      setIsDeviceModalOpen(false);
      fetchDevices(currentPage, pageSize, searchTerm || undefined, statusFilter || undefined, categoryFilter || undefined);
    } catch (err) {
      // Handled by store
    }
  };

  const handleImportFile = async (file: File) => {
    setError(null);
    setImportResult(null);
    setIsImporting(true);
    try {
      const result = await deviceService.bulkImport(file);
      setImportResult(result);
      fetchDevices(
        currentPage,
        pageSize,
        searchTerm || undefined,
        statusFilter || undefined,
        categoryFilter || undefined,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV import failed");
    } finally {
      setIsImporting(false);
    }
  };

  const clearImportResult = () => setImportResult(null);

  const handleDeleteClick = (id: string) => {
    setDeviceToDelete(id);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!deviceToDelete) return;
    setError(null);
    try {
      await deleteDevice(deviceToDelete);
      setIsDeleteConfirmOpen(false);
      setDeviceToDelete(null);
      fetchDevices(currentPage, pageSize, searchTerm || undefined, statusFilter || undefined, categoryFilter || undefined);
    } catch (err) {
      // Handled by store
    }
  };

  return {
    user,
    devices,
    isDevicesLoading,
    devicesError,
    warehouses,
    searchTerm,
    statusFilter,
    categoryFilter,
    currentPage,
    setCurrentPage,
    pageSize,
    isDeviceModalOpen,
    setIsDeviceModalOpen,
    modalType,
    selectedDevice,
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
  };
}

export default useDevices;
