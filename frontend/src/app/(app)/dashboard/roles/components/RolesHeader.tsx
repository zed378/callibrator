// src/app/dashboard/roles/components/RolesHeader.tsx
"use client";

import React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui";

interface RolesHeaderProps {
  onAddRole: () => void;
}

export const RolesHeader: React.FC<RolesHeaderProps> = ({ onAddRole }) => {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Roles Management
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage system roles and their permissions
        </p>
      </div>
      <Button
        variant="primary"
        leftIcon={<Plus className="h-4 w-4" />}
        onClick={onAddRole}
      >
        Add Role
      </Button>
    </div>
  );
};

export default RolesHeader;
