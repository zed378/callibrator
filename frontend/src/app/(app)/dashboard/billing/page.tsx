// src/app/dashboard/billing/page.tsx
"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { useBilling } from "./hooks/useBilling";
import SubscriptionCard from "./components/SubscriptionCard";
import PlanQuotaCard from "./components/PlanQuotaCard";
import InvoicesTable from "./components/InvoicesTable";

export default function BillingPage() {
  const {
    subscription,
    isSubscriptionLoading,
    subscriptionError,
    canEditSubscription,
    form,
    setForm,
    isSaving,
    handleSaveSubscription,
    invoices,
    invoicesMeta,
    isInvoicesLoading,
    invoicesError,
    setInvoicesPage,
    pageSize,
    statusFilter,
    handleStatusFilterChange,
  } = useBilling();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Billing &amp; Subscription
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your subscription plan and view invoice history.
          </p>
        </div>

        <PlanQuotaCard />

        <SubscriptionCard
          subscription={subscription}
          isLoading={isSubscriptionLoading}
          error={subscriptionError}
          canEdit={canEditSubscription}
          form={form}
          setForm={setForm}
          isSaving={isSaving}
          onSave={handleSaveSubscription}
        />

        <InvoicesTable
          invoices={invoices}
          meta={invoicesMeta}
          isLoading={isInvoicesLoading}
          error={invoicesError}
          statusFilter={statusFilter}
          onStatusFilterChange={handleStatusFilterChange}
          pageSize={pageSize}
          onPageChange={setInvoicesPage}
        />
      </div>
    </DashboardLayout>
  );
}
