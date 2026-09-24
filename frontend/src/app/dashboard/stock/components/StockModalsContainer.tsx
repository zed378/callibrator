import React from "react";
import StockModal from "./StockModal";
import AdjustmentModal from "./AdjustmentModal";
import TransferModal from "./TransferModal";
import OpnameModal from "./OpnameModal";

// Each modal owns its form's type; this container only threads them through.
type StockModalProps = React.ComponentProps<typeof StockModal>;
type AdjustmentModalProps = React.ComponentProps<typeof AdjustmentModal>;
type TransferModalProps = React.ComponentProps<typeof TransferModal>;
type OpnameModalProps = React.ComponentProps<typeof OpnameModal>;

interface StockModalsContainerProps {
  isStockModalOpen: boolean;
  setIsStockModalOpen: (open: boolean) => void;
  stockModalType: "create" | "edit";
  hasWriteAccess: boolean;
  stockForm: StockModalProps["form"];
  setStockForm: StockModalProps["setForm"];
  warehouseOptions: StockModalProps["warehouseOptions"];
  locationOptions: StockModalProps["locationOptions"];
  fetchLocations: (id: string) => void;
  handleStockSubmit: (e: React.FormEvent) => void;
  isAdjustmentModalOpen: boolean;
  setIsAdjustmentModalOpen: (open: boolean) => void;
  selectedStock: AdjustmentModalProps["selectedStock"];
  adjustmentForm: AdjustmentModalProps["form"];
  setAdjustmentForm: AdjustmentModalProps["setForm"];
  handleAdjustmentSubmit: (e: React.FormEvent) => void;
  isTransferModalOpen: boolean;
  setIsTransferModalOpen: (open: boolean) => void;
  transferForm: TransferModalProps["form"];
  setTransferForm: TransferModalProps["setForm"];
  handleTransferSubmit: (e: React.FormEvent) => void;
  isOpnameModalOpen: boolean;
  setIsOpnameModalOpen: (open: boolean) => void;
  opnameForm: OpnameModalProps["form"];
  setOpnameForm: OpnameModalProps["setForm"];
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
