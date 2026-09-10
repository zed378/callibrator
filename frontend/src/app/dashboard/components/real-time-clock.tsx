"use client";

import { Clock } from "lucide-react";
import React, { useEffect, useState } from "react";

const RealTimeClock: React.FC = () => {
  // `time` starts null and is set after mount — reading `new Date()` during
  // render is non-deterministic and not allowed during prerender in Next 16.
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    // Sync to the system clock after mount — reading current time during render
    // is disallowed during prerender (Next 16). This is a legitimate external-
    // system subscription, so the set-state-in-effect heuristic doesn't apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedTime = time
    ? time.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      })
    : "--:--:--";
  const formattedDate = time
    ? time.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-card border-border shadow-sm">
        <Clock className="w-4 h-4 text-primary" />
        <span className="text-lg font-mono font-bold tracking-wider text-foreground">
          {formattedTime}
        </span>
      </div>
      <div className="px-4 py-2.5 rounded-xl border bg-card border-border shadow-sm">
        <span className="text-sm font-medium text-muted-foreground">
          {formattedDate}
        </span>
      </div>
    </div>
  );
};

export default RealTimeClock;
