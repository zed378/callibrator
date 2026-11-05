"use client";

import React from "react";
import { Button } from "@/components/ui";

const QuickAction: React.FC<{
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
  delay?: number;
}> = ({ icon, label, color, onClick }) => {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="relative group flex flex-col items-center gap-3 p-5 rounded-2xl border border-border bg-card shadow-sm hover:shadow-md hover:border-primary/30"
    >
      <div
        className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center`}
      >
        {icon}
      </div>
      <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
    </Button>
  );
};

export default QuickAction;
