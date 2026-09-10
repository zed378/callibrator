// src/app/dashboard/billing/components/PlanQuotaCard.tsx
"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
  Alert,
  Skeleton,
} from "@/components/ui";
import { quotaService, Quota } from "@/api/services/quota.service";

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : "-";

const prettifyFeature = (feature: string) =>
  feature
    .split("_")
    .map((part) => capitalize(part))
    .join(" ");

const isUnlimited = (limit: number | null | undefined) =>
  limit === null || limit === undefined || limit < 0;

interface UsageMeterProps {
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
}

const UsageMeter: React.FC<UsageMeterProps> = ({
  label,
  used,
  limit,
  unit = "",
}) => {
  const unlimited = isUnlimited(limit);
  const percent =
    unlimited || !limit ? 0 : Math.min(100, (used / limit) * 100);
  const barColor =
    percent >= 100
      ? "bg-destructive"
      : percent >= 80
        ? "bg-warning"
        : "bg-primary";

  const format = (value: number) =>
    `${value.toLocaleString()}${unit ? ` ${unit}` : ""}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-sm font-medium text-foreground">
          {unlimited ? (
            <>
              {format(used)}{" "}
              <span className="text-muted-foreground">&middot; Unlimited</span>
            </>
          ) : (
            <>
              {format(used)} of {format(limit as number)}
            </>
          )}
        </p>
      </div>
      <div className="bg-muted rounded-full h-2 overflow-hidden">
        <div
          className={`${barColor} h-2 rounded-full transition-all duration-500`}
          style={{ width: unlimited ? "0%" : `${percent}%` }}
        />
      </div>
    </div>
  );
};

const getPlanBadgeVariant = (
  plan: string,
): "default" | "primary" | "success" | "info" => {
  switch (plan) {
    case "enterprise":
      return "success";
    case "business":
      return "primary";
    case "professional":
      return "info";
    default:
      return "default";
  }
};

export const PlanQuotaCard: React.FC = () => {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchQuota = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await quotaService.getQuota();
        if (isMounted) setQuota(data);
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : "Failed to load plan usage",
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    fetchQuota();
    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <Card className="border-border">
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return <Alert variant="error">{error}</Alert>;
  }

  if (!quota) {
    return (
      <Card className="border-border">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No plan information available.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader
        title="Plan & Usage"
        subtitle="Your current plan, enabled features and resource usage."
        action={
          <Badge variant={getPlanBadgeVariant(quota.plan)}>
            {capitalize(quota.plan)}
          </Badge>
        }
      />
      <CardContent>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tenant Status
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {capitalize(quota.status)}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Features
            </p>
            {quota.features.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {quota.features.map((feature) => (
                  <Badge key={feature} variant="secondary" size="sm">
                    {prettifyFeature(feature)}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No additional features enabled.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <UsageMeter
              label="Seats"
              used={quota.seats.used}
              limit={quota.seats.limit}
            />
            <UsageMeter
              label="Storage"
              used={quota.storage.usedMb}
              limit={quota.storage.limitMb}
              unit="MB"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PlanQuotaCard;
