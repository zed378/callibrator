"use client";

import { LayoutGrid, AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface PageHeaderProps {
  error: string | null;
  onCreateMenuGroup?: () => void;
}

export function PageHeader({ error, onCreateMenuGroup }: PageHeaderProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-info/10">
              <LayoutGrid
                className="text-info"
              />
            </div>
            <div>
              <h1
                className="text-2xl font-bold text-foreground"
              >
                Menu Groups Assignment
              </h1>
              <p
                className="text-sm mt-1 text-muted-foreground"
              >
                Assign menu groups and items to roles for dynamic sidebar
                navigation
              </p>
            </div>
          </div>
          {onCreateMenuGroup && (
            <Button
              variant="primary"
              size="sm"
              onClick={onCreateMenuGroup}
              className="flex-shrink-0"
            >
              <Plus className="w-4 h-4 mr-1" />
              New Menu Group
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="p-4 rounded-lg flex items-center gap-3 bg-destructive/10 border-destructive/30 text-destructive"
        >
          <AlertTriangle
            className="w-5 h-5 flex-shrink-0 text-destructive"
          />
          <span className="text-sm">{error}</span>
        </div>
      )}
    </div>
  );
}
