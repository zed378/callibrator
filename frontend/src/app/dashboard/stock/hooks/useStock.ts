// src/app/dashboard/stock/hooks/useStock.ts
import { useEffect, useState, useCallback } from "react";
import { useStockStore } from "@/stores/stockStore";
import { stockService } from "@/api/services/stock.service";
import { useWarehouseStore } from "@/stores/warehouseStore";
import { useAuthStore } from "@/stores/authStore";
import { Stock, StockTransfer, StockAdjustment, StockOpname } from "@/types";

export function useStock() {
  const { user } = useAuthStore();
  const {
    stocks,
    transfers,
    adjustments,
    opnames,
    reportSummary,
    isLoading,
    error,
    fetchStocks,
    createStock,
    updateStock,
    createAdjustment,
    fetchAdjustments,
    createTransfer,
    updateTransferStatus,
    fetchTransfers,
    createOpname,
    updateOpnameStatus,
    fetchOpnames,
    fetchReportSummary,
    setError,
  } = useStockStore();

  const {
    warehouses,
    locations,
    fetchWarehouses,
    fetchLocations,
  } = useWarehouseStore();

  // Navigation Tabs: inventory, transfers, adjustments, opnames, reports
  const [activeTab, setActiveTab] = useState<"inventory" | "transfers" | "adjustments" | "opnames" | "reports">("inventory");

  // Filters State
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modal State
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [stockModalType, setStockModalType] = useState<"create" | "edit">("create");
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);

  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isOpnameModalOpen, setIsOpnameModalOpen] = useState(false);

  // Forms State
  const [stockForm, setStockForm] = useState({
    warehouseId: "",
    locationId: "",
    itemName: "",
    sku: "",
    serialNumber: "",
    quantity: 0,
    minQuantity: 0,
    description: "",
  });

  const [adjustmentForm, setAdjustmentForm] = useState({
    stockId: "",
    type: "addition" as "addition" | "subtraction" | "write_off",
    quantity: 1,
    reason: "",
  });

  const [transferForm, setTransferForm] = useState({
    fromWarehouseId: "",
    toWarehouseId: "",
    itemName: "",
    quantity: 1,
    notes: "",
  });

  const [opnameForm, setOpnameForm] = useState({
    warehouseId: "",
    scheduledAt: "",
    notes: "",
  });

  // Check write access based on approved specs
  const hasWriteAccess =
    user?.role?.name === "SUPERADMIN" ||
    user?.role?.name === "HEALTHCARE ADMIN" ||
    user?.role?.name === "WAREHOUSE STAFF";

  // Initial Fetches
  useEffect(() => {
    fetchWarehouses(1, 100);
  }, [fetchWarehouses]);

  // Fetch sub-locations if a warehouse filter is chosen
  useEffect(() => {
    if (selectedWarehouseId) {
      fetchLocations(selectedWarehouseId);
    } else {
      setSelectedLocationId("");
    }
  }, [selectedWarehouseId, fetchLocations]);

  // Fetch primary data based on active tab & filters
  const loadTabData = useCallback(() => {
    if (activeTab === "inventory") {
      fetchStocks({
        page: currentPage,
        limit: pageSize,
        find: searchTerm,
        warehouseId: selectedWarehouseId || undefined,
        locationId: selectedLocationId || undefined,
      });
    } else if (activeTab === "transfers") {
      fetchTransfers({
        page: currentPage,
        limit: pageSize,
        fromWarehouseId: selectedWarehouseId || undefined,
      });
    } else if (activeTab === "adjustments") {
      fetchAdjustments({
        page: currentPage,
        limit: pageSize,
        warehouseId: selectedWarehouseId || undefined,
      });
    } else if (activeTab === "opnames") {
      fetchOpnames({
        page: currentPage,
        limit: pageSize,
        warehouseId: selectedWarehouseId || undefined,
      });
    } else if (activeTab === "reports") {
      fetchReportSummary();
    }
  }, [
    activeTab,
    currentPage,
    pageSize,
    searchTerm,
    selectedWarehouseId,
    selectedLocationId,
    fetchStocks,
    fetchTransfers,
    fetchAdjustments,
    fetchOpnames,
    fetchReportSummary,
  ]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleWarehouseFilterChange = (val: string) => {
    setSelectedWarehouseId(val);
    setSelectedLocationId("");
    setCurrentPage(1);
  };

  const handleTabChange = (tab: "inventory" | "transfers" | "adjustments" | "opnames" | "reports") => {
    setActiveTab(tab);
    setCurrentPage(1);
    setError(null);
  };

  const downloadCsv = (filename: string, csvContent: string) => {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportStocks = async () => {
    try {
      const csv = await stockService.exportInventoryCsv();
      downloadCsv("current_stock_levels.csv", csv);
    } catch (err) {
      setError("Failed to export stock levels");
    }
  };

  const handleExportTransfers = async () => {
    try {
      const res = await stockService.getTransfers({ limit: 1000 });
      const headers = ["Item Name", "Quantity", "From Warehouse", "To Warehouse", "Status", "Requested By", "Approved By", "Date Requested"];
      const escape = (val: unknown) => `"${String(val || "").replace(/"/g, '""')}"`;
      const rows = [
        headers.join(","),
        ...res.data.map(t => [
          escape(t.itemName),
          escape(t.quantity),
          escape(t.fromWarehouse?.name),
          escape(t.toWarehouse?.name),
          escape(t.status),
          escape(t.requester ? `${t.requester.firstName} ${t.requester.lastName}` : ""),
          escape(t.approver ? `${t.approver.firstName} ${t.approver.lastName}` : ""),
          escape(t.createdAt)
        ].join(","))
      ];
      downloadCsv("stock_transfers_history.csv", rows.join("\n"));
    } catch (err) {
      setError("Failed to export stock transfers");
    }
  };

  const handleExportAdjustments = async () => {
    try {
      const res = await stockService.getAdjustments({ limit: 1000 });
      const headers = ["Warehouse", "Adjustment Type", "Quantity Delta", "Reason", "Performed By", "Date Logged"];
      const escape = (val: unknown) => `"${String(val || "").replace(/"/g, '""')}"`;
      const rows = [
        headers.join(","),
        ...res.data.map(a => [
          escape(a.warehouse?.name),
          escape(a.type),
          escape(a.quantity),
          escape(a.reason),
          escape(a.adjuster ? `${a.adjuster.firstName} ${a.adjuster.lastName}` : ""),
          escape(a.createdAt)
        ].join(","))
      ];
      downloadCsv("stock_adjustments_history.csv", rows.join("\n"));
    } catch (err) {
      setError("Failed to export stock adjustments");
    }
  };

  const handleExportOpnames = async () => {
    try {
      const res = await stockService.getOpnames({ limit: 1000 });
      const headers = ["Warehouse", "Status", "Scheduled At", "Completed At", "Notes"];
      const escape = (val: unknown) => `"${String(val || "").replace(/"/g, '""')}"`;
      const rows = [
        headers.join(","),
        ...res.data.map(o => [
          escape(o.warehouse?.name),
          escape(o.status),
          escape(o.scheduledAt),
          escape(o.completedAt),
          escape(o.notes)
        ].join(","))
      ];
      downloadCsv("stock_opname_history.csv", rows.join("\n"));
    } catch (err) {
      setError("Failed to export stock audits");
    }
  };

  // Stock CRUD Operations
  const openCreateStock = () => {
    setStockForm({
      warehouseId: selectedWarehouseId || (warehouses?.data?.[0]?.id || ""),
      locationId: "",
      itemName: "",
      sku: "",
      serialNumber: "",
      quantity: 0,
      minQuantity: 0,
      description: "",
    });
    setStockModalType("create");
    setSelectedStock(null);
    setIsStockModalOpen(true);
  };

  const openEditStock = (stock: Stock) => {
    setStockForm({
      warehouseId: stock.warehouseId,
      locationId: stock.locationId || "",
      itemName: stock.itemName,
      sku: stock.sku || "",
      serialNumber: stock.serialNumber || "",
      quantity: stock.quantity,
      minQuantity: stock.minQuantity,
      description: stock.description || "",
    });
    setStockModalType("edit");
    setSelectedStock(stock);
    setIsStockModalOpen(true);
  };

  const handleStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (stockModalType === "create") {
        await createStock({
          ...stockForm,
          locationId: stockForm.locationId || null,
          sku: stockForm.sku || null,
          serialNumber: stockForm.serialNumber || null,
          description: stockForm.description || null,
        });
      } else if (stockModalType === "edit" && selectedStock) {
        await updateStock(selectedStock.id, {
          itemName: stockForm.itemName,
          sku: stockForm.sku || null,
          serialNumber: stockForm.serialNumber || null,
          quantity: stockForm.quantity,
          minQuantity: stockForm.minQuantity,
          description: stockForm.description || null,
        });
      }
      setIsStockModalOpen(false);
      loadTabData();
    } catch (err) {
      // Handled by store
    }
  };

  const openAdjustment = (stock: Stock) => {
    setAdjustmentForm({
      stockId: stock.id,
      type: "addition",
      quantity: 1,
      reason: "",
    });
    setSelectedStock(stock);
    setIsAdjustmentModalOpen(true);
  };

  const handleAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createAdjustment(adjustmentForm);
      setIsAdjustmentModalOpen(false);
      loadTabData();
    } catch (err) {
      // Handled by store
    }
  };

  const openTransfer = (stock?: Stock) => {
    setTransferForm({
      fromWarehouseId: stock?.warehouseId || selectedWarehouseId || "",
      toWarehouseId: "",
      itemName: stock?.itemName || "",
      quantity: 1,
      notes: "",
    });
    setIsTransferModalOpen(true);
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createTransfer(transferForm);
      setIsTransferModalOpen(false);
      loadTabData();
    } catch (err) {
      // Handled by store
    }
  };

  const handleUpdateTransferStatus = async (id: string, status: "pending" | "in_transit" | "completed" | "cancelled") => {
    setError(null);
    try {
      await updateTransferStatus(id, status);
      loadTabData();
    } catch (err) {
      // Handled by store
    }
  };

  const openOpname = () => {
    setOpnameForm({
      warehouseId: selectedWarehouseId || (warehouses?.data?.[0]?.id || ""),
      scheduledAt: new Date().toISOString().slice(0, 16),
      notes: "",
    });
    setIsOpnameModalOpen(true);
  };

  const handleOpnameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createOpname({
        ...opnameForm,
        scheduledAt: new Date(opnameForm.scheduledAt).toISOString(),
      });
      setIsOpnameModalOpen(false);
      loadTabData();
    } catch (err) {
      // Handled by store
    }
  };

  const handleUpdateOpnameStatus = async (id: string, status: "draft" | "in_progress" | "completed") => {
    setError(null);
    try {
      await updateOpnameStatus(id, status);
      loadTabData();
    } catch (err) {
      // Handled by store
    }
  };

  return {
    user,
    stocks,
    transfers,
    adjustments,
    opnames,
    reportSummary,
    isLoading,
    error,
    activeTab,
    searchTerm,
    selectedWarehouseId,
    selectedLocationId,
    setSelectedLocationId,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    isStockModalOpen,
    setIsStockModalOpen,
    stockModalType,
    selectedStock,
    isAdjustmentModalOpen,
    setIsAdjustmentModalOpen,
    isTransferModalOpen,
    setIsTransferModalOpen,
    isOpnameModalOpen,
    setIsOpnameModalOpen,
    stockForm,
    setStockForm,
    adjustmentForm,
    setAdjustmentForm,
    transferForm,
    setTransferForm,
    opnameForm,
    setOpnameForm,
    hasWriteAccess,
    handleSearchChange,
    handleWarehouseFilterChange,
    handleTabChange,
    handleExportStocks,
    handleExportTransfers,
    handleExportAdjustments,
    handleExportOpnames,
    openCreateStock,
    openEditStock,
    handleStockSubmit,
    openAdjustment,
    handleAdjustmentSubmit,
    openTransfer,
    handleTransferSubmit,
    handleUpdateTransferStatus,
    openOpname,
    handleOpnameSubmit,
    handleUpdateOpnameStatus,
    warehouses,
    locations,
    fetchLocations,
  };
}

export default useStock;
