// src/app/dashboard/vendors/hooks/useVendors.ts
import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import {
  Vendor,
  VendorCreateInput,
  VendorStatus,
  VendorType,
  vendorService,
} from "@/api/services/vendor.service";
import { PaginatedResponse } from "@/types";

export interface VendorFormState {
  name: string;
  type: VendorType;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  status: VendorStatus;
  rating: string;
}

const emptyForm: VendorFormState = {
  name: "",
  type: "CalibrationLab",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  status: "Active",
  rating: "",
};

export function useVendors() {
  const { user } = useAuthStore();
  const { addToast } = useToastStore();

  // Data state
  const [vendors, setVendors] = useState<PaginatedResponse<Vendor> | null>(
    null,
  );
  const [isVendorsLoading, setIsVendorsLoading] = useState(true);
  const [vendorsError, setVendorsError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

  // Modal State
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"create" | "edit">("create");
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [vendorToDelete, setVendorToDelete] = useState<string | null>(null);

  // Form State
  const [form, setForm] = useState<VendorFormState>(emptyForm);

  // User Permissions check
  const hasWriteAccess =
    user?.role?.name === "SUPERADMIN" ||
    user?.role?.name === "HEALTHCARE ADMIN" ||
    user?.role?.name === "CALIBRATOR ADMIN";

  const fetchVendors = useCallback(async () => {
    setIsVendorsLoading(true);
    setVendorsError(null);
    try {
      const result = await vendorService.getAll(
        currentPage,
        pageSize,
        searchTerm || undefined,
        statusFilter || undefined,
        typeFilter || undefined,
      );
      setVendors(result);
    } catch (err) {
      setVendorsError(
        err instanceof Error ? err.message : "Failed to load vendors",
      );
    } finally {
      setIsVendorsLoading(false);
    }
  }, [currentPage, pageSize, searchTerm, statusFilter, typeFilter]);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const handleTypeChange = (value: string) => {
    setTypeFilter(value);
    setCurrentPage(1);
  };

  const openCreateModal = () => {
    setForm(emptyForm);
    setModalType("create");
    setSelectedVendor(null);
    setIsVendorModalOpen(true);
  };

  const openEditModal = (vendor: Vendor) => {
    setForm({
      name: vendor.name,
      type: vendor.type,
      contactPerson: vendor.contactPerson || "",
      email: vendor.email || "",
      phone: vendor.phone || "",
      address: vendor.address || "",
      status: vendor.status,
      rating: vendor.rating != null ? String(vendor.rating) : "",
    });
    setModalType("edit");
    setSelectedVendor(vendor);
    setIsVendorModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVendorsError(null);
    setIsSubmitting(true);
    try {
      const payload: VendorCreateInput = {
        name: form.name.trim(),
        type: form.type,
        contactPerson: form.contactPerson.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        status: form.status,
        rating: form.rating === "" ? undefined : Number(form.rating),
      };

      if (modalType === "create") {
        await vendorService.create(payload);
        addToast({ type: "success", title: "Vendor created" });
      } else if (modalType === "edit" && selectedVendor) {
        await vendorService.update({ ...payload, id: selectedVendor.id });
        addToast({ type: "success", title: "Vendor updated" });
      }
      setIsVendorModalOpen(false);
      fetchVendors();
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to save vendor",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQualify = async (vendorId: string, approvalStatus: string) => {
    setIsSubmitting(true);
    try {
      await vendorService.qualify(vendorId, { approvalStatus });
      addToast({
        type: "success",
        title: `Vendor ${approvalStatus.toLowerCase()}`,
      });
      fetchVendors();
    } catch (err) {
      addToast({
        type: "error",
        title:
          err instanceof Error
            ? err.message
            : "Failed to update vendor qualification",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (id: string) => {
    setVendorToDelete(id);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!vendorToDelete) return;
    setVendorsError(null);
    setIsSubmitting(true);
    try {
      await vendorService.delete(vendorToDelete);
      addToast({ type: "success", title: "Vendor deleted" });
      setIsDeleteConfirmOpen(false);
      setVendorToDelete(null);
      fetchVendors();
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to delete vendor",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    user,
    vendors,
    isVendorsLoading,
    vendorsError,
    isSubmitting,
    searchTerm,
    statusFilter,
    typeFilter,
    currentPage,
    setCurrentPage,
    pageSize,
    isVendorModalOpen,
    setIsVendorModalOpen,
    modalType,
    selectedVendor,
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
  };
}

export default useVendors;
