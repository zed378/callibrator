"use client";

import { Clock } from "lucide-react";
import React from "react";

const ActivityTimelineItem: React.FC<{
  name: string;
  action: string;
  time: string;
  color: string;
  delay?: number;
}> = ({ name, action, time, color }) => {
  return (
    <div className="flex items-center gap-4 p-3.5 rounded-xl transition-colors hover:bg-muted/30">
      <div className="relative">
        <div
          className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center flex-shrink-0`}
        >
          <span className="text-sm font-bold text-primary">{name.charAt(0)}</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate text-foreground">
          {name}
        </p>
        <p className="text-xs truncate text-muted-foreground">
          {action}
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-xs flex-shrink-0 text-muted-foreground">
        <Clock className="w-3 h-3" />
        <span>{time}</span>
      </div>
    </div>
  );
};

export default ActivityTimelineItem;
