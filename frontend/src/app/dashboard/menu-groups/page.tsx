// src/app/dashboard/menu-groups/page.tsx
"use client";

import { Loader2 } from "lucide-react";
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

  const handleSelectAllAssigned = () => {};

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
              isItemFullyAssigned={(_g: any, i: any) => isItemAssigned(_g, i)}
              isItemPartiallyAssigned={() => false}
              onToggleGroup={toggleAssign}
              onAssignGroup={handleAssign}
              onRevokeGroup={handleRevoke}
              onToggleAll={handleSelectAllAssigned}
              onBulkAssign={handleBulkAssign}
              onBulkRevoke={handleBulkRevoke}
              onToggleItem={toggleItemAssign}
              onEditGroup={isSuperAdmin ? openEditModal : undefined}
              onDeleteGroup={isSuperAdmin ? handleDeleteClick : undefined}
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
