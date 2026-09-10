// src/app/dashboard/stock/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Stock, StockTransfer, StockAdjustment, StockOpname } from "@/types";
import { Button, Card, CardContent, Pagination, Alert, TableSkeleton } from "@/components/ui";
import { Plus, ArrowLeftRight, ClipboardList, History } from "lucide-react";
import { useStock } from "./hooks/useStock";
import ReportsTab from "./components/ReportsTab";
import InventoryTable from "./components/InventoryTable";
import TransfersTable from "./components/TransfersTable";
import AdjustmentsTable from "./components/AdjustmentsTable";
import OpnamesTable from "./components/OpnamesTable";
import StockFilters from "./components/StockFilters";
import StockModalsContainer from "./components/StockModalsContainer";

export default function StockPage() {
  const {
    isLoading, error, activeTab, searchTerm, selectedWarehouseId, selectedLocationId, setSelectedLocationId,
    currentPage, setCurrentPage, pageSize, setPageSize, isStockModalOpen, setIsStockModalOpen, stockModalType,
    selectedStock, isAdjustmentModalOpen, setIsAdjustmentModalOpen, isTransferModalOpen, setIsTransferModalOpen,
    isOpnameModalOpen, setIsOpnameModalOpen, stockForm, setStockForm, adjustmentForm, setAdjustmentForm,
    transferForm, setTransferForm, opnameForm, setOpnameForm, hasWriteAccess, handleSearchChange,
    handleWarehouseFilterChange, handleTabChange, handleExportStocks, handleExportTransfers,
    handleExportAdjustments, handleExportOpnames, openCreateStock, openEditStock, handleStockSubmit,
    openAdjustment, handleAdjustmentSubmit, openTransfer, handleTransferSubmit, handleUpdateTransferStatus,
    openOpname, handleOpnameSubmit, handleUpdateOpnameStatus, warehouses, locations, fetchLocations,
    reportSummary, stocks, transfers, adjustments, opnames
  } = useStock();

  const warehouseOptions = warehouses?.data?.map((w) => ({ value: w.id, label: `${w.name} (${w.code})` })) || [];
  const locationOptions = locations?.filter((l) => l.isActive).map((l) => ({ value: l.id, label: `${l.name} (${l.code})` })) || [];

  const getTableData = () => {
    if (activeTab === "inventory") return { data: stocks?.data || [], meta: stocks?.meta };
    if (activeTab === "transfers") return { data: transfers?.data || [], meta: transfers?.meta };
    if (activeTab === "adjustments") return { data: adjustments?.data || [], meta: adjustments?.meta };
    return { data: opnames?.data || [], meta: opnames?.meta };
  };

  const { data: tableRows, meta: tableMeta } = getTableData();
  const rawData = tableRows || [];
  const activeMeta = tableMeta || { total: 0, page: 1, limit: 10, totalPages: 1 };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Inventory & Stocks</h1>
            <p className="text-muted-foreground mt-1">Verify stock volumes, log write-offs, dispatch inter-depot transfers, and perform audits.</p>
          </div>
          {hasWriteAccess && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" leftIcon={<ArrowLeftRight className="h-4.5 w-4.5" />} onClick={() => openTransfer()}>New Transfer</Button>
              <Button variant="secondary" leftIcon={<ClipboardList className="h-4.5 w-4.5" />} onClick={openOpname}>Audit Stock</Button>
              <Button variant="primary" leftIcon={<Plus className="h-4.5 w-4.5" />} onClick={openCreateStock}>Add Inventory</Button>
            </div>
          )}
        </div>

        <div className="flex border-b border-border overflow-x-auto">
          {(["inventory", "transfers", "adjustments", "opnames", "reports"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`px-5 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-all ${
                activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {tab === "inventory" ? "Current Stock" : tab === "transfers" ? "Inter-depot Transfers" : tab === "adjustments" ? "Manual Adjustments" : tab === "opnames" ? "Physical Counts (Audits)" : "Reports"}
            </button>
          ))}
        </div>

        <StockFilters
          activeTab={activeTab}
          searchTerm={searchTerm}
          handleSearchChange={handleSearchChange}
          selectedWarehouseId={selectedWarehouseId}
          handleWarehouseFilterChange={handleWarehouseFilterChange}
          warehouseOptions={warehouseOptions}
          selectedLocationId={selectedLocationId}
          setSelectedLocationId={setSelectedLocationId}
          setCurrentPage={setCurrentPage}
          locationOptions={locationOptions}
        />

        {error && <Alert variant="error">{error}</Alert>}

        {activeTab === "reports" ? (
          <ReportsTab
            reportSummary={reportSummary}
            onExportStocks={handleExportStocks}
            onExportTransfers={handleExportTransfers}
            onExportAdjustments={handleExportAdjustments}
            onExportOpnames={handleExportOpnames}
          />
        ) : isLoading ? (
          <TableSkeleton rows={5} cols={4} />
        ) : rawData.length > 0 ? (
          <Card className="overflow-hidden">
            {activeTab === "inventory" && (
              <InventoryTable data={rawData as Stock[]} hasWriteAccess={hasWriteAccess} openAdjustment={openAdjustment} openTransfer={openTransfer} openEditStock={openEditStock} />
            )}
            {activeTab === "transfers" && (
              <TransfersTable data={rawData as StockTransfer[]} hasWriteAccess={hasWriteAccess} handleUpdateTransferStatus={handleUpdateTransferStatus} />
            )}
            {activeTab === "adjustments" && (
              <AdjustmentsTable data={rawData as StockAdjustment[]} />
            )}
            {activeTab === "opnames" && (
              <OpnamesTable data={rawData as StockOpname[]} hasWriteAccess={hasWriteAccess} handleUpdateOpnameStatus={handleUpdateOpnameStatus} />
            )}
            <div className="px-6 py-4 border-t border-border">
              <Pagination
                currentPage={activeMeta.page}
                totalPages={activeMeta.totalPages}
                totalItems={activeMeta.total || 0}
                pageSize={activeMeta.limit}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
                pageSizes={[5, 10, 25, 50]}
              />
            </div>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-16 text-center">
              <History className="mx-auto h-16 w-16 text-muted-foreground" />
              <h3 className="text-xl font-semibold text-foreground mt-4">No Records Registered</h3>
<p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                 {activeTab === "inventory" ? "Define inventory items to track them in this warehouse depot." : `There is no logged history of ${activeTab} in this system.`}
               </p>
            </CardContent>
          </Card>
        )}

        <StockModalsContainer
          isStockModalOpen={isStockModalOpen}
          setIsStockModalOpen={setIsStockModalOpen}
          stockModalType={stockModalType}
          hasWriteAccess={hasWriteAccess}
          stockForm={stockForm}
          setStockForm={setStockForm}
          warehouseOptions={warehouseOptions}
          locationOptions={locationOptions}
          fetchLocations={fetchLocations}
          handleStockSubmit={handleStockSubmit}
          isAdjustmentModalOpen={isAdjustmentModalOpen}
          setIsAdjustmentModalOpen={setIsAdjustmentModalOpen}
          selectedStock={selectedStock}
          adjustmentForm={adjustmentForm}
          setAdjustmentForm={setAdjustmentForm}
          handleAdjustmentSubmit={handleAdjustmentSubmit}
          isTransferModalOpen={isTransferModalOpen}
          setIsTransferModalOpen={setIsTransferModalOpen}
          transferForm={transferForm}
          setTransferForm={setTransferForm}
          handleTransferSubmit={handleTransferSubmit}
          isOpnameModalOpen={isOpnameModalOpen}
          setIsOpnameModalOpen={setIsOpnameModalOpen}
          opnameForm={opnameForm}
          setOpnameForm={setOpnameForm}
          handleOpnameSubmit={handleOpnameSubmit}
        />
      </div>
    </DashboardLayout>
  );
}
