// src/app/dashboard/users/page.tsx
"use client";

import React from "react";
import type { User } from "@/types";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Button,
  Alert,
  Card,
  CardContent,
  TableSkeleton,
} from "@/components/ui";
import { Plus, User as UserIcon } from "lucide-react";
import { SearchInput } from "./components/SearchInput";
import { StatsCards } from "./components/StatsCards";
import { UserTable } from "./components/UserTable";
import { CreateModal } from "./components/CreateModal";
import { EditModal } from "./components/EditModal";
import { useUsers } from "./hooks/useUsers";

export default function UsersPage() {
  const {
    users,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showCreateModal,
    setShowCreateModal,
    showEditModal,
    setShowEditModal,
    editingUser,
    formError,
    isSubmitting,
    createForm,
    setCreateForm,
    editForm,
    setEditForm,
    passwordRules,
    usernameAvailability,
    checkUsernameAvailability,
    validatePassword,
    handleDelete,
    handleDeleteRequest,
    handleCancelCreate,
    handleCancelEdit,
    handleCreate,
    handleEdit,
    handleUpdate,
    getStatusColor,
    roleOptions,
    tenantOptions,
    statusOptions,
    usersList,
  } = useUsers();

  const [createPicture, setCreatePicture] = React.useState("");
  const [editPicture, setEditPicture] = React.useState("");

  const handlePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCreatePicture(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClearCreatePicture = () => {
    setCreatePicture("");
  };

  const handleClearEditPicture = () => {
    setEditPicture("");
  };

  const handleEditUser = (user: User) => {
    setEditPicture(user.picture || "");
    handleEdit(user);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Users Management
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage system users and their permissions
            </p>
          </div>
          <Button
            variant="primary"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setShowCreateModal(true)}
          >
            Add User
          </Button>
        </div>

        <StatsCards total={users?.meta?.total || 0} data={usersList} />

        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search users..."
        />

        {error && (
          <Alert variant="error" title={error}>
            {error}
          </Alert>
        )}

        {isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : usersList.length > 0 ? (
          <UserTable
            users={usersList}
            showDeleteConfirm={showDeleteConfirm}
            currentPage={currentPage}
            totalPages={
              usersList.length
                ? (users != null ? users.meta?.totalPages : undefined) || 1
                : 1
            }
            totalItems={
              usersList.length
                ? (users != null ? users.meta?.total : undefined) || 0
                : 0
            }
            pageSize={pageSize}
            onEdit={handleEditUser}
            onDeleteRequest={handleDeleteRequest}
            onDeleteConfirm={handleDelete}
            onCancelDelete={() => setShowDeleteConfirm(null)}
            onPageChange={(page) => setCurrentPage(page)}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
            getStatusColor={getStatusColor}
          />
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <UserIcon className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground mt-4">
                No users found
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <CreateModal
        show={showCreateModal}
        onClose={handleCancelCreate}
        form={createForm}
        setForm={setCreateForm}
        error={formError}
        submitting={isSubmitting}
        usernameAvailability={usernameAvailability}
        checkUsername={(username) => checkUsernameAvailability(username)}
        validatePassword={validatePassword}
        rules={passwordRules}
        roleOptions={roleOptions}
        tenantOptions={tenantOptions}
        onSubmit={handleCreate}
        picture={createPicture}
        setPicture={setCreatePicture}
        onPictureChange={handlePictureChange}
      />

      <EditModal
        show={showEditModal}
        onClose={handleCancelEdit}
        user={editingUser}
        form={editForm}
        setForm={setEditForm}
        error={formError}
        submitting={isSubmitting}
        usernameAvailability={usernameAvailability}
        checkUsername={checkUsernameAvailability}
        statusOptions={statusOptions}
        onSubmit={handleUpdate}
        picture={editPicture}
        setPicture={setEditPicture}
        onPictureChange={handlePictureChange}
        onClearPicture={handleClearEditPicture}
      />
    </DashboardLayout>
  );
}
