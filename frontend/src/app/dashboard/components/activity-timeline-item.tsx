"use client";

import { Clock } from "lucide-react";
import React, { useEffect, useState } from "react";

const ActivityTimelineItem: React.FC<{
  name: string;
  action: string;
  time: string;
  color: string;
  delay: number;
}> = ({ name, action, time, color, delay }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={`flex items-center gap-4 p-3.5 rounded-xl transition-all duration-500 group hover:bg-muted/30 ${
        isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"
      }`}
    >
      <div className="relative">
        <div
          className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300 shadow-none dark:shadow-lg`}
        >
          <span className="text-sm font-bold text-white">{name.charAt(0)}</span>
        </div>
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 bg-success border-white`}
        />
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
