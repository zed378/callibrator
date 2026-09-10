"use client";

import React, { useEffect, useState } from "react";

const HealthIndicator: React.FC<{
  name: string;
  status: "healthy" | "warning" | "error";
  uptime?: string;
  delay: number;
}> = ({ name, status, uptime, delay }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  const statusConfig = {
    healthy: {
      dot: "bg-success",
      shadow: "shadow-success/50",
      label: "Operational",
      labelColor: "text-success",
      bgColor: "bg-success/10",
      borderColor: "border-success/30",
    },
    warning: {
      dot: "bg-warning",
      shadow: "shadow-warning/50",
      label: "Warning",
      labelColor: "text-warning",
      bgColor: "bg-warning/10",
      borderColor: "border-warning/30",
    },
    error: {
      dot: "bg-destructive",
      shadow: "shadow-destructive/50",
      label: "Down",
      labelColor: "text-destructive",
      bgColor: "bg-destructive/10",
      borderColor: "border-destructive/30",
    },
  };

  const config = statusConfig[status];

  return (
    <div
      className={`relative p-5 rounded-2xl ${config.bgColor} border ${config.borderColor} transition-all duration-700 ${
        isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="relative">
          <div
            className={`w-2.5 h-2.5 ${config.dot} rounded-full ${config.shadow} animate-pulse`}
          />
        </div>
        <span className={`text-sm font-semibold ${config.labelColor}`}>
          {config.label}
        </span>
      </div>
      <p className="text-sm font-medium text-foreground/70">
        {name}
      </p>
      {uptime && (
        <p className="text-xs mt-1 text-muted-foreground">
          {uptime}
        </p>
      )}
    </div>
  );
};

export default HealthIndicator;
