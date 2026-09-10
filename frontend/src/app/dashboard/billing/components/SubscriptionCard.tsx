// src/app/dashboard/billing/components/SubscriptionCard.tsx
import React from "react";
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
  Alert,
  Select,
  Button,
  Skeleton,
} from "@/components/ui";
import { Subscription } from "@/api/services/billing.service";
import { SubscriptionForm } from "../hooks/useBilling";

interface SubscriptionCardProps {
  subscription: Subscription | null;
  isLoading: boolean;
  error: string | null;
  canEdit: boolean;
  form: SubscriptionForm;
  setForm: React.Dispatch<React.SetStateAction<SubscriptionForm>>;
  isSaving: boolean;
  onSave: () => void;
}

const capitalize = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : "-";

const getStatusBadge = (status: Subscription["status"]) => {
  const maps: Record<
    Subscription["status"],
    { variant: "success" | "warning" | "danger"; label: string }
  > = {
    Active: { variant: "success", label: "Active" },
    PastDue: { variant: "warning", label: "Past Due" },
    Canceled: { variant: "danger", label: "Canceled" },
    Unpaid: { variant: "danger", label: "Unpaid" },
  };
  const current = maps[status] || {
    variant: "warning" as const,
    label: status,
  };
  return <Badge variant={current.variant}>{current.label}</Badge>;
};

export const SubscriptionCard: React.FC<SubscriptionCardProps> = ({
  subscription,
  isLoading,
  error,
  canEdit,
  form,
  setForm,
  isSaving,
  onSave,
}) => {
  if (isLoading) {
    return (
      <Card className="border-border">
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return <Alert variant="error">{error}</Alert>;
  }

  if (!subscription) {
    return (
      <Card className="border-border">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No subscription found.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader
        title="Current Subscription"
        subtitle="Your active plan and billing period."
        action={getStatusBadge(subscription.status)}
      />
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Plan
            </p>
            <p className="mt-1 text-lg font-bold text-foreground">
              {capitalize(subscription.planId)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Billing Cycle
            </p>
            <p className="mt-1 text-lg font-bold text-foreground">
              {subscription.billingCycle}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Current Period
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {new Date(subscription.currentPeriodStart).toLocaleDateString()}{" "}
              &ndash;{" "}
              {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </p>
          </div>
        </div>

        {canEdit && (
          <div className="mt-6 pt-6 border-t border-border">
            <h4 className="text-sm font-semibold text-foreground mb-4">
              Edit subscription
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-foreground">
                  Plan
                </label>
                <Select
                  value={form.planId}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, planId: value }))
                  }
                  options={[
                    { value: "basic", label: "Basic" },
                    { value: "professional", label: "Professional" },
                    { value: "enterprise", label: "Enterprise" },
                  ]}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-foreground">
                  Billing Cycle
                </label>
                <Select
                  value={form.billingCycle}
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      billingCycle: value as SubscriptionForm["billingCycle"],
                    }))
                  }
                  options={[
                    { value: "Monthly", label: "Monthly" },
                    { value: "Annually", label: "Annually" },
                  ]}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-foreground">
                  Status
                </label>
                <Select
                  value={form.status}
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      status: value as SubscriptionForm["status"],
                    }))
                  }
                  options={[
                    { value: "Active", label: "Active" },
                    { value: "PastDue", label: "Past Due" },
                    { value: "Canceled", label: "Canceled" },
                    { value: "Unpaid", label: "Unpaid" },
                  ]}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={onSave} isLoading={isSaving}>
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SubscriptionCard;
