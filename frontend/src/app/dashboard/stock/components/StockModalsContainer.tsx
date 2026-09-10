import React from "react";
import StockModal from "./StockModal";
import AdjustmentModal from "./AdjustmentModal";
import TransferModal from "./TransferModal";
import OpnameModal from "./OpnameModal";

interface StockModalsContainerProps {
  isStockModalOpen: boolean;
  setIsStockModalOpen: (open: boolean) => void;
  stockModalType: "create" | "edit";
  hasWriteAccess: boolean;
  stockForm: any;
  setStockForm: any;
  warehouseOptions: any[];
  locationOptions: any[];
  fetchLocations: (id: string) => void;
  handleStockSubmit: (e: React.FormEvent) => void;
  isAdjustmentModalOpen: boolean;
  setIsAdjustmentModalOpen: (open: boolean) => void;
  selectedStock: any;
  adjustmentForm: any;
  setAdjustmentForm: any;
  handleAdjustmentSubmit: (e: React.FormEvent) => void;
  isTransferModalOpen: boolean;
  setIsTransferModalOpen: (open: boolean) => void;
  transferForm: any;
  setTransferForm: any;
  handleTransferSubmit: (e: React.FormEvent) => void;
  isOpnameModalOpen: boolean;
  setIsOpnameModalOpen: (open: boolean) => void;
  opnameForm: any;
  setOpnameForm: any;
  handleOpnameSubmit: (e: React.FormEvent) => void;
}

export const StockModalsContainer: React.FC<StockModalsContainerProps> = ({
  isStockModalOpen,
  setIsStockModalOpen,
  stockModalType,
  hasWriteAccess,
  stockForm,
  setStockForm,
  warehouseOptions,
  locationOptions,
  fetchLocations,
  handleStockSubmit,
  isAdjustmentModalOpen,
  setIsAdjustmentModalOpen,
  selectedStock,
  adjustmentForm,
  setAdjustmentForm,
  handleAdjustmentSubmit,
  isTransferModalOpen,
  setIsTransferModalOpen,
  transferForm,
  setTransferForm,
  handleTransferSubmit,
  isOpnameModalOpen,
  setIsOpnameModalOpen,
  opnameForm,
  setOpnameForm,
  handleOpnameSubmit,
}) => {
  return (
    <>
      <StockModal
        isOpen={isStockModalOpen}
        onClose={() => setIsStockModalOpen(false)}
        modalType={stockModalType}
        hasWriteAccess={hasWriteAccess}
        form={stockForm}
        setForm={setStockForm}
        warehouseOptions={warehouseOptions}
        locationOptions={locationOptions}
        onWarehouseChange={(val) => {
          setStockForm({ ...stockForm, warehouseId: val, locationId: "" });
          fetchLocations(val);
        }}
        onSubmit={handleStockSubmit}
      />

      <AdjustmentModal
        isOpen={isAdjustmentModalOpen}
        onClose={() => setIsAdjustmentModalOpen(false)}
        selectedStock={selectedStock}
        form={adjustmentForm}
        setForm={setAdjustmentForm}
        onSubmit={handleAdjustmentSubmit}
      />

      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        form={transferForm}
        setForm={setTransferForm}
        warehouseOptions={warehouseOptions}
        onSubmit={handleTransferSubmit}
      />

      <OpnameModal
        isOpen={isOpnameModalOpen}
        onClose={() => setIsOpnameModalOpen(false)}
        form={opnameForm}
        setForm={setOpnameForm}
        warehouseOptions={warehouseOptions}
        onSubmit={handleOpnameSubmit}
      />
    </>
  );
};

export default StockModalsContainer;
