// src/app/dashboard/components/DashboardQuickActions.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  Plus,
  Building2,
  Shield,
  Mail,
  Settings,
  Globe,
} from "lucide-react";
import QuickAction from "./quick-action";

export const DashboardQuickActions: React.FC = () => {
  const router = useRouter();

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <Zap className="w-5 h-5 text-warning" />
        <h2 className="text-lg font-semibold text-foreground">
          Quick Actions
        </h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <QuickAction
          icon={<Plus className="w-6 h-6 text-primary" />}
          label="Add User"
          color="bg-primary/15"
          onClick={() => router.push("/dashboard/users")}
          delay={500}
        />
        <QuickAction
          icon={<Building2 className="w-6 h-6 text-accent" />}
          label="New Tenant"
          color="bg-accent/15"
          onClick={() => router.push("/dashboard/tenants")}
          delay={600}
        />
        <QuickAction
          icon={<Shield className="w-6 h-6 text-success" />}
          label="Roles"
          color="bg-success/15"
          onClick={() => router.push("/dashboard/roles")}
          delay={700}
        />
        <QuickAction
          icon={<Mail className="w-6 h-6 text-info" />}
          label="Notifications"
          color="bg-info/15"
          onClick={() => router.push("/dashboard/notifications")}
          delay={800}
        />
        <QuickAction
          icon={<Settings className="w-6 h-6 text-warning" />}
          label="Settings"
          color="bg-warning/15"
          onClick={() => router.push("/dashboard/profile")}
          delay={900}
        />
        <QuickAction
          icon={<Globe className="w-6 h-6 text-destructive" />}
          label="View Site"
          color="bg-destructive/15"
          onClick={() => window.open("/", "_blank", "noopener,noreferrer")}
          delay={1000}
        />
      </div>
    </div>
  );
};

export default DashboardQuickActions;
