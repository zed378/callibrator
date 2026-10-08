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
import { usePermissions } from "@/hooks/usePermissions";

export default function UsersPage() {
  // ADR-102: creating users is gated on `users` write (user.route.js).
  const { canWrite } = usePermissions();
  const mayWriteUsers = canWrite("users");
  const {
    users,
    isLoading,
    error,
    setCreatePhotoFile,
    setEditPhotoFile,
    setEditPhotoRemoved,
    photoNotice,
    setPhotoNotice,
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
      setCreatePhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setCreatePicture(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // The edit dialog's own picker: it used to share handlePictureChange, so a
  // photo chosen while editing landed in the CREATE dialog's preview.
  const handleEditPictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setEditPhotoFile(file);
      setEditPhotoRemoved(false);
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditPicture(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClearEditPicture = () => {
    setEditPicture("");
    setEditPhotoFile(null);
    setEditPhotoRemoved(true);
  };

  /** The Create dialog's "Remove photo": the preview AND the file to send go. */
  const setCreatePictureAndFile: React.Dispatch<React.SetStateAction<string>> = (
    value,
  ) => {
    setCreatePicture(value);
    if (value === "") setCreatePhotoFile(null);
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
          {mayWriteUsers && (
            <Button
              variant="primary"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => setShowCreateModal(true)}
            >
              Add User
            </Button>
          )}
        </div>

        <StatsCards total={users?.meta?.total || 0} data={usersList} />

        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search users..."
        />

        {photoNotice && (
          <Alert variant="warning" onClose={() => setPhotoNotice("")}>
            {photoNotice}
          </Alert>
        )}
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
        ) : error && !users ? null /* a failed load: the alert above is the state */ : (
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
        setPicture={setCreatePictureAndFile}
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
        onPictureChange={handleEditPictureChange}
        onClearPicture={handleClearEditPicture}
      />
    </DashboardLayout>
  );
}
