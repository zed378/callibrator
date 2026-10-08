"use client";

import React, { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

/**
 * One dependency probe as a tile. ADR-122 Amendment 1: the state is a status
 * badge from the registry (lib/statusTone.ts "health": shape, icon, word and
 * colour), not a coloured tile with a pulsing dot — colour alone said "down"
 * before. The tile itself is a neutral card.
 */
const HealthIndicator: React.FC<{
  name: string;
  /**
   * "neutral" is for a state that is neither a pass nor a fail — not
   * configured, or configured but not measured. It must never look green.
   */
  status: "healthy" | "warning" | "error" | "neutral";
  uptime?: string;
  /** Overrides the default label for the status. */
  label?: string;
  delay: number;
}> = ({ name, status, uptime, label, delay }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={`relative p-5 rounded-2xl bg-card border border-border transition-all duration-700 ${
        isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
      }`}
    >
      <div className="mb-3">
        <StatusBadge domain="health" state={status} size="sm">
          {label}
        </StatusBadge>
      </div>
      <p className="text-sm font-medium text-foreground">{name}</p>
      {uptime && <p className="text-xs mt-1 text-muted-foreground">{uptime}</p>}
    </div>
  );
};

export default HealthIndicator;
