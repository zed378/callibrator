"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui";

const QuickAction: React.FC<{
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
  delay: number;
}> = ({ icon, label, color, onClick, delay }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={`relative group flex flex-col items-center gap-3 p-5 rounded-2xl transition-all duration-500 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      } border border-border bg-card shadow-sm hover:shadow-md hover:border-primary/30`}
    >
      <div
        className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center group-hover:scale-110 group-hover:rotate-6 transition-all duration-500 shadow-none dark:shadow-lg`}
      >
        {icon}
      </div>
      <span className="text-sm font-medium group-hover:transition-colors duration-300 text-muted-foreground group-hover:text-foreground/80">
        {label}
      </span>
    </Button>
  );
};

export default QuickAction;
