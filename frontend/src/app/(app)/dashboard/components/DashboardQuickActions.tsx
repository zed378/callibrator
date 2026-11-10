// src/app/dashboard/components/DashboardQuickActions.tsx
'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/hooks/usePermissions';

/**
 * ADR-102: each action is offered only when the API serves it to the caller —
 * Add User needs `users` write; New Tenant and Roles are the super admin's
 * (POST /tenants/create is superAdminOnly, the roles API rbac SUPERADMIN);
 * Notifications needs `notifications` read. They were shown to every role.
 *
 * Plain text buttons in one row: six tinted icon tiles (one hue each, "View Site"
 * in the destructive red) made a navigation shortcut look like a status board.
 */
const ACTION =
  'rounded-lg border border-border bg-card px-4 min-h-11 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted/40';

export const DashboardQuickActions: React.FC = () => {
  const router = useRouter();
  const { superAdmin, canRead, canWrite } = usePermissions();

  return (
    <section aria-labelledby="quick-actions-title">
      <h2 id="quick-actions-title" className="mb-3 text-sm font-semibold text-muted-foreground">
        Quick Actions
      </h2>
      <div className="flex flex-wrap gap-2">
        {canWrite('users') && (
          <button type="button" className={ACTION} onClick={() => router.push('/dashboard/users')}>
            Add User
          </button>
        )}
        {superAdmin && (
          <button type="button" className={ACTION} onClick={() => router.push('/dashboard/tenants')}>
            New Tenant
          </button>
        )}
        {superAdmin && (
          <button type="button" className={ACTION} onClick={() => router.push('/dashboard/roles')}>
            Roles
          </button>
        )}
        {canRead('notifications') && (
          <button type="button" className={ACTION} onClick={() => router.push('/dashboard/notifications')}>
            Notifications
          </button>
        )}
        <button type="button" className={ACTION} onClick={() => router.push('/dashboard/profile')}>
          Settings
        </button>
        <button
          type="button"
          className={ACTION}
          onClick={() => window.open('/', '_blank', 'noopener,noreferrer')}
        >
          View Site
        </button>
      </div>
    </section>
  );
};

export default DashboardQuickActions;
