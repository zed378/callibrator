// src/app/dashboard/menu-groups/page.tsx
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { useMenuGroups } from "./hooks/useMenuGroups";
import { useMenuGroupCrud } from "./hooks/useMenuGroupCrud";
import {
  ToastNotification,
  PageHeader,
  RoleSelectionCard,
  BulkActionBar,
  AssignNotesField,
  SummaryStats,
  MenuGroupCrudModal,
  DeleteMenuGroupModal,
} from "./components";

export default function MenuGroupsPage() {
  const {
    roles,
    menuGroups,
    selectedRoleId,
    setSelectedRoleId,
    selectedGroupIds,
    allSelected,
    toggleSelected,
    toggleSelectAll,
    loading,
    actionLoading,
    assignNotes,
    setAssignNotes,
    error,
    toast,
    toggleAssign,
    handleAssign,
    handleRevoke,
    handleBulkAssign,
    handleBulkRevoke,
    toggleItemAssign,
    isItemAssigned,
    getGroupAssignmentState,
    showToast,
    refresh,
  } = useMenuGroups();

  const {
    isSuperAdmin,
    crudModalOpen,
    setCrudModalOpen,
    crudModalType,
    crudLoading,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    crudForm,
    setCrudForm,
    openCreateModal,
    openEditModal,
    handleCrudSubmit,
    handleDeleteClick,
    confirmDelete,
  } = useMenuGroupCrud({ showToast, onMutated: refresh });

  // A-300: a bulk revoke takes pages away from every user of the role, so it
  // is confirmed, naming how many groups and which role.
  const [confirmBulkRevoke, setConfirmBulkRevoke] = useState(false);
  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const roleLabel = selectedRole?.nameToShow || selectedRole?.name || "this role";
  const confirmRevoke = async () => {
    await handleBulkRevoke();
    setConfirmBulkRevoke(false);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span className="ml-3">Loading menu groups...</span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <ToastNotification toast={toast} />
      <div className="space-y-6 ">
        <PageHeader
          error={error}
          onCreateMenuGroup={isSuperAdmin ? openCreateModal : undefined}
        />
        <RoleSelectionCard
          roles={roles}
          selectedRoleId={selectedRoleId}
          onSelectRole={setSelectedRoleId}
        />
        {selectedRoleId && (
          <>
            <BulkActionBar
              menuGroups={menuGroups}
              actionLoading={actionLoading}
              getGroupAssignmentState={getGroupAssignmentState}
              isItemAssigned={isItemAssigned}
              isItemFullyAssigned={isItemAssigned}
              isItemPartiallyAssigned={() => false}
              onToggleGroup={toggleAssign}
              onAssignGroup={handleAssign}
              onRevokeGroup={handleRevoke}
              selectedIds={selectedGroupIds}
              allSelected={allSelected}
              onToggleSelect={toggleSelected}
              onToggleAll={toggleSelectAll}
              onBulkAssign={handleBulkAssign}
              onBulkRevoke={() => setConfirmBulkRevoke(true)}
              onToggleItem={toggleItemAssign}
              onEditGroup={isSuperAdmin ? openEditModal : undefined}
              onDeleteGroup={isSuperAdmin ? handleDeleteClick : undefined}
            />
            <ConfirmDialog
              isOpen={confirmBulkRevoke}
              title="Revoke selected menu groups"
              description={`Revoke ${selectedGroupIds.length} selected menu group(s) from ${roleLabel}? Users with this role lose access to those pages. You can assign them again later.`}
              confirmLabel="Revoke"
              variant="danger"
              isLoading={actionLoading}
              onConfirm={confirmRevoke}
              onCancel={() => setConfirmBulkRevoke(false)}
            />
            <AssignNotesField
              value={assignNotes}
              onChange={setAssignNotes}
              disabled={actionLoading}
            />
            <SummaryStats
              menuGroups={menuGroups}
              roles={roles}
              selectedRoleId={selectedRoleId}
            />
          </>
        )}
        {isSuperAdmin && (
          <>
            <MenuGroupCrudModal
              isOpen={crudModalOpen}
              onClose={() => setCrudModalOpen(false)}
              modalType={crudModalType}
              isLoading={crudLoading}
              form={crudForm}
              setForm={setCrudForm}
              onSubmit={handleCrudSubmit}
            />
            <DeleteMenuGroupModal
              isOpen={deleteConfirmOpen}
              onClose={() => setDeleteConfirmOpen(false)}
              onConfirm={confirmDelete}
              isLoading={crudLoading}
            />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
