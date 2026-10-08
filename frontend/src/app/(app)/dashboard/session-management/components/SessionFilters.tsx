import React from "react";
import { Input, Select } from "@/components/ui";
import { Search, Filter } from "lucide-react";

interface SessionFiltersProps {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  filterStatus: string;
  onFilterChange: (v: string) => void;
}

export const SessionFilters: React.FC<SessionFiltersProps> = ({
  searchQuery,
  onSearchChange,
  filterStatus,
  onFilterChange,
}) => {
  const filterOptions = [
    { value: "all", label: "All Sessions" },
    { value: "active", label: "Active Only" },
    { value: "expired", label: "Expired Only" },
    { value: "revoked", label: "Revoked Only" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by IP, device, or user agent..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select
            value={filterStatus}
            onChange={onFilterChange}
            options={filterOptions}
            className="w-48"
          />
        </div>
      </div>
    </div>
  );
};
