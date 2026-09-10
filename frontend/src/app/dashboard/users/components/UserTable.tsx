import React from "react";
import type { User } from "@/types";
import { Card } from "@/components/ui";
import { Pagination } from "@/components/ui/Table";
import { UserRow } from "./UserRow";

interface UserTableProps {
  users: User[];
  showDeleteConfirm: string | null;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onEdit: (user: User) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onCancelDelete: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  getStatusColor: (status: string) => string;
}

export const UserTable: React.FC<UserTableProps> = ({
  users,
  showDeleteConfirm,
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onCancelDelete,
  onPageChange,
  onPageSizeChange,
  getStatusColor,
}) => {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto overflow-y-hidden">
        <table className="w-full table-fixed">
          <thead className="bg-muted">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border min-w-[180px]">
                Name
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border min-w-0">
                Username
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border min-w-0">
                Role
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border min-w-0">
                Status
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border min-w-0">
                Created
              </th>
              <th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border min-w-0">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                showDeleteConfirm={showDeleteConfirm}
                onEdit={onEdit}
                onDeleteRequest={onDeleteRequest}
                onDeleteConfirm={onDeleteConfirm}
                onCancelDelete={onCancelDelete}
                getStatusColor={getStatusColor}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        pageSizes={[10, 25, 50, 100]}
      />
    </Card>
  );
};
