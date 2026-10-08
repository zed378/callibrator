// src/app/dashboard/reports/components/ReportCards.tsx
import React from "react";
import { Card, CardContent } from "@/components/ui";

export const prettifyKey = (key: string) =>
  key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/** A small metric card: label on top, big value below. */
export const MetricCard: React.FC<{
  title: string;
  value: number | string;
  subtitle?: string;
  valueClassName?: string;
}> = ({ title, value, subtitle, valueClassName = "text-foreground" }) => (
  <Card className="border-border">
    <CardContent className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${valueClassName}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {subtitle && (
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      )}
    </CardContent>
  </Card>
);

/** A card listing key/count pairs (e.g. work orders by status). */
export const BreakdownCard: React.FC<{
  title: string;
  data: Record<string, number> | undefined | null;
  emptyMessage?: string;
}> = ({ title, data, emptyMessage = "No data" }) => {
  const entries = Object.entries(data || {});
  return (
    <Card className="border-border">
      <CardContent className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {title}
        </p>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ul className="space-y-2">
            {entries.map(([key, count]) => (
              <li
                key={key}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">
                  {prettifyKey(key)}
                </span>
                <span className="font-semibold text-foreground">
                  {count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
