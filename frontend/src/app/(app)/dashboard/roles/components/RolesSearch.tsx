import React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui";

interface RolesSearchProps {
  searchTerm: string;
  onChange: (value: string) => void;
}

export const RolesSearch: React.FC<RolesSearchProps> = ({
  searchTerm,
  onChange,
}) => (
  <div className="flex flex-col sm:flex-row gap-4">
    <div className="relative flex-1">
      <input
        type="text"
        placeholder="Search roles..."
        value={searchTerm}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
      />
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
    </div>
  </div>
);
