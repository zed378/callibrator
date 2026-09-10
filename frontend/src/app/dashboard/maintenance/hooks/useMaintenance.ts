// src/app/dashboard/maintenance/hooks/useMaintenance.ts
import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import {
  WorkOrder,
  WorkOrderCreateInput,
  WorkOrderPriority,
  WorkOrderStatus,
  WorkOrderType,
  maintenanceService,
} from "@/api/services/maintenance.service";
import { Device, deviceService } from "@/api/services/device.service";
import { Vendor, vendorService } from "@/api/services/vendor.service";
import { PaginatedResponse } from "@/types";

export interface WorkOrderFormState {
  deviceId: string;
  title: string;
  description: string;
  type: WorkOrderType;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  vendorId: string;
}

const emptyForm: WorkOrderFormState = {
  deviceId: "",
  title: "",
  description: "",
  type: "Preventative",
  priority: "Medium",
  status: "Open",
  vendorId: "",
};

export function useMaintenance() {
  const { user } = useAuthStore();
  const { addToast } = useToastStore();

  // Data state
  const [workOrders, setWorkOrders] =
    useState<PaginatedResponse<WorkOrder> | null>(null);
  const [isWorkOrdersLoading, setIsWorkOrdersLoading] = useState(true);
  const [workOrdersError, setWorkOrdersError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reference data for the modal selects
  const [devices, setDevices] = useState<Device[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

  // Modal State
  const [isWorkOrderModalOpen, setIsWorkOrderModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"create" | "edit">("create");
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(
    null,
  );
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [workOrderToDelete, setWorkOrderToDelete] = useState<string | null>(
    null,
  );

  // Form State
  const [form, setForm] = useState<WorkOrderFormState>(emptyForm);

  // User Permissions check
  const hasWriteAccess =
    user?.role?.name === "SUPERADMIN" ||
    user?.role?.name === "HEALTHCARE ADMIN" ||
    user?.role?.name === "CALIBRATOR ADMIN";

  const fetchWorkOrders = useCallback(async () => {
    setIsWorkOrdersLoading(true);
    setWorkOrdersError(null);
    try {
      const result = await maintenanceService.getAll({
        page: currentPage,
        limit: pageSize,
        find: searchTerm || undefined,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        type: typeFilter || undefined,
      });
      setWorkOrders(result);
    } catch (err) {
      setWorkOrdersError(
        err instanceof Error ? err.message : "Failed to load work orders",
      );
    } finally {
      setIsWorkOrdersLoading(false);
    }
  }, [currentPage, pageSize, searchTerm, statusFilter, priorityFilter, typeFilter]);

  useEffect(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);

  // Load reference data (devices & vendors) once for the modal selects
  useEffect(() => {
    let cancelled = false;
    const loadReferenceData = async () => {
      try {
        const [devicesResult, vendorsResult] = await Promise.all([
          deviceService.getAll(1, 100),
          vendorService.getAll(1, 100),
        ]);
        if (!cancelled) {
          setDevices(devicesResult.data ?? []);
          setVendors(vendorsResult.data ?? []);
        }
      } catch {
        // Non-fatal: the modal selects will just be empty.
      }
    };
    loadReferenceData();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const handlePriorityChange = (value: string) => {
    setPriorityFilter(value);
    setCurrentPage(1);
  };

  const handleTypeChange = (value: string) => {
    setTypeFilter(value);
    setCurrentPage(1);
  };

  const openCreateModal = () => {
    setForm(emptyForm);
    setModalType("create");
    setSelectedWorkOrder(null);
    setIsWorkOrderModalOpen(true);
  };

  const openEditModal = (workOrder: WorkOrder) => {
    setForm({
      deviceId: workOrder.deviceId,
      title: workOrder.title,
      description: workOrder.description || "",
      type: workOrder.type,
      priority: workOrder.priority,
      status: workOrder.status,
      vendorId: workOrder.vendorId || "",
    });
    setModalType("edit");
    setSelectedWorkOrder(workOrder);
    setIsWorkOrderModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.deviceId) {
      addToast({ type: "error", title: "Please select a device" });
      return;
    }
    setWorkOrdersError(null);
    setIsSubmitting(true);
    try {
      const payload: WorkOrderCreateInput = {
        deviceId: form.deviceId,
        title: form.title.trim(),
        type: form.type,
        description: form.description.trim() || undefined,
        priority: form.priority,
        status: form.status,
        vendorId: form.vendorId || undefined,
      };

      if (modalType === "create") {
        await maintenanceService.create(payload);
        addToast({ type: "success", title: "Work order created" });
      } else if (modalType === "edit" && selectedWorkOrder) {
        await maintenanceService.update({
          ...payload,
          id: selectedWorkOrder.id,
        });
        addToast({ type: "success", title: "Work order updated" });
      }
      setIsWorkOrderModalOpen(false);
      fetchWorkOrders();
    } catch (err) {
      addToast({
        type: "error",
        title:
          err instanceof Error ? err.message : "Failed to save work order",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (id: string) => {
    setWorkOrderToDelete(id);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!workOrderToDelete) return;
    setWorkOrdersError(null);
    setIsSubmitting(true);
    try {
      await maintenanceService.delete(workOrderToDelete);
      addToast({ type: "success", title: "Work order deleted" });
      setIsDeleteConfirmOpen(false);
      setWorkOrderToDelete(null);
      fetchWorkOrders();
    } catch (err) {
      addToast({
        type: "error",
        title:
          err instanceof Error ? err.message : "Failed to delete work order",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    user,
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
    currentPage,
    setCurrentPage,
    pageSize,
    isWorkOrderModalOpen,
    setIsWorkOrderModalOpen,
    modalType,
    selectedWorkOrder,
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
  };
}

export default useMaintenance;
