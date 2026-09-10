import React from "react";

interface SkeletonProps {
  className?: string;
  variant?: "circle" | "rect" | "text" | "rounded";
  width?: string;
  height?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = "",
  variant = "rect",
  width,
  height,
}) => {
  const base =
    "animate-pulse bg-muted rounded";
  const variants: Record<string, string> = {
    circle: "rounded-full",
    rect: "rounded",
    text: "rounded h-4",
    rounded: "rounded-lg",
  };

  return (
    <div
      className={`${base} ${variants[variant]} ${className}`}
      style={
        width || height
          ? { width: width || "auto", height: height || "auto" }
          : undefined
      }
    />
  );
};

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({
  rows = 5,
  cols = 5,
}) => {
  return (
    <div className="space-y-4 w-full">
      {/* Header Skeleton */}
      <div className="flex gap-4 w-full bg-muted0/5 p-4 rounded-xl">
        {Array.from({ length: cols }).map((_, j) => (
          <Skeleton key={j} className="h-5 flex-grow" />
        ))}
      </div>
      {/* Rows Skeletons */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 w-full p-4 border border-border rounded-xl items-center">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-grow" />
          ))}
        </div>
      ))}
    </div>
  );
};

export const CardSkeleton: React.FC<{ cards?: number }> = ({ cards = 3 }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full animate-fade-in">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="p-6 rounded-2xl bg-card space-y-4 shadow-xs">
          <div className="flex items-center gap-3">
            <Skeleton variant="circle" className="w-12 h-12" />
            <div className="space-y-2 flex-grow">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-16 w-full rounded-xl" />
          <div className="flex gap-2 justify-end pt-2">
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
};
