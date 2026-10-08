import React from "react";
import { Input, Select } from "@/components/ui";
import { Search } from "lucide-react";

interface StockFiltersProps {
  activeTab: string;
  searchTerm: string;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  selectedWarehouseId: string;
  handleWarehouseFilterChange: (val: string) => void;
  warehouseOptions: { value: string; label: string }[];
  selectedLocationId: string;
  setSelectedLocationId: (val: string) => void;
  setCurrentPage: (page: number) => void;
  locationOptions: { value: string; label: string }[];
}

export const StockFilters: React.FC<StockFiltersProps> = ({
  activeTab,
  searchTerm,
  handleSearchChange,
  selectedWarehouseId,
  handleWarehouseFilterChange,
  warehouseOptions,
  selectedLocationId,
  setSelectedLocationId,
  setCurrentPage,
  locationOptions,
}) => {
  if (activeTab === "reports") return null;

  return (
    <div className="flex flex-wrap gap-4 items-center bg-muted/20 p-4 rounded-2xl border border-border">
      {activeTab === "inventory" && (
        <div className="w-full sm:w-72 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search description, SKU..."
            value={searchTerm}
            onChange={handleSearchChange}
            className="pl-9"
          />
        </div>
      )}
      <div className="w-full sm:w-56">
        <Select
          value={selectedWarehouseId}
          onChange={handleWarehouseFilterChange}
          options={[{ value: "", label: "All Depots" }, ...warehouseOptions]}
        />
      </div>
      {activeTab === "inventory" && selectedWarehouseId && (
        <div className="w-full sm:w-56">
          <Select
            value={selectedLocationId}
            onChange={(val) => {
              setSelectedLocationId(val);
              setCurrentPage(1);
            }}
            options={[{ value: "", label: "All Storage Shelves" }, ...locationOptions]}
          />
        </div>
      )}
    </div>
  );
};

export default StockFilters;
