// src/app/dashboard/components/DashboardQuickActions.tsx
'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Building2, Shield, Mail, Settings, Globe } from 'lucide-react';
import QuickAction from './quick-action';
import { usePermissions } from '@/hooks/usePermissions';

/**
 * ADR-102: each action is offered only when the API serves it to the caller —
 * Add User needs `users` write; New Tenant and Roles are the super admin's
 * (POST /tenants/create is superAdminOnly, the roles API rbac SUPERADMIN);
 * Notifications needs `notifications` read. They were shown to every role.
 */
export const DashboardQuickActions: React.FC = () => {
  const router = useRouter();
  const { superAdmin, canRead, canWrite } = usePermissions();

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-lg font-semibold text-foreground">Quick Actions</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {canWrite('users') && (
          <QuickAction
            icon={<Plus className="w-6 h-6 text-primary" />}
            label="Add User"
            color="bg-primary/15"
            onClick={() => router.push('/dashboard/users')}
          />
        )}
        {superAdmin && (
          <QuickAction
            icon={<Building2 className="w-6 h-6 text-chart-2" />}
            label="New Tenant"
            color="bg-chart-2/15"
            onClick={() => router.push('/dashboard/tenants')}
          />
        )}
        {superAdmin && (
          <QuickAction
            icon={<Shield className="w-6 h-6 text-success" />}
            label="Roles"
            color="bg-success/15"
            onClick={() => router.push('/dashboard/roles')}
          />
        )}
        {canRead('notifications') && (
          <QuickAction
            icon={<Mail className="w-6 h-6 text-info" />}
            label="Notifications"
            color="bg-info/15"
            onClick={() => router.push('/dashboard/notifications')}
          />
        )}
        <QuickAction
          icon={<Settings className="w-6 h-6 text-warning" />}
          label="Settings"
          color="bg-warning/15"
          onClick={() => router.push('/dashboard/profile')}
        />
        <QuickAction
          icon={<Globe className="w-6 h-6 text-destructive" />}
          label="View Site"
          color="bg-destructive/15"
          onClick={() => window.open('/', '_blank', 'noopener,noreferrer')}
        />
      </div>
    </div>
  );
};

export default DashboardQuickActions;
