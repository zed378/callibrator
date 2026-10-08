// src/app/dashboard/users/components/CreateUserForm.tsx
"use client";

import React from "react";
import { Input, Select } from "@/components/ui";
import { Button } from "@/components/ui";
import PasswordChecklist from "./PasswordChecklist";
import UsernameAvailabilityStatus from "./UsernameAvailabilityStatus";

interface CreateFormProps {
  createForm: {
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    roleId: string;
    tenantId: string;
  };
  setCreateForm: React.Dispatch<
    React.SetStateAction<{
      username: string;
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      roleId: string;
      tenantId: string;
    }>
  >;
  formError: string;
  isSubmitting: boolean;
  passwordValidation: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSymbol: boolean;
  };
  usernameAvailability: {
    checking: boolean;
    available: boolean | null;
  };
  checkUsernameAvailability: (
    username: string,
    isEditing?: boolean,
    existingUsername?: string,
  ) => void;
  validatePassword: (password: string) => void;
  roleOptions: { value: string; label: string }[];
  tenantOptions: { value: string; label: string }[];
  onSubmit: (e: React.FormEvent) => void;
}

export const CreateUserForm: React.FC<CreateFormProps> = ({
  createForm,
  setCreateForm,
  formError,
  isSubmitting,
  passwordValidation,
  usernameAvailability,
  checkUsernameAvailability,
  validatePassword,
  roleOptions,
  tenantOptions,
  onSubmit,
}) => {
  return (
    <form onSubmit={onSubmit}>
      <div className="space-y-4">
        {formError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="First Name"
            value={createForm.firstName}
            onChange={(e) =>
              setCreateForm({
                ...createForm,
                firstName: e.target.value,
              })
            }
            placeholder="John"
            required
          />
          <Input
            label="Last Name"
            value={createForm.lastName}
            onChange={(e) =>
              setCreateForm({ ...createForm, lastName: e.target.value })
            }
            placeholder="Doe"
            required
          />
        </div>
        
        <div>
          <Input
            label="Username"
            value={createForm.username}
            onChange={(e) => {
              setCreateForm({ ...createForm, username: e.target.value });
              checkUsernameAvailability(e.target.value);
            }}
            placeholder="johndoe"
            required
          />
          <UsernameAvailabilityStatus
            username={createForm.username}
            availability={usernameAvailability}
          />
        </div>

        <Input
          label="Email"
          type="email"
          value={createForm.email}
          onChange={(e) =>
            setCreateForm({ ...createForm, email: e.target.value })
          }
          placeholder="john@hospital.com"
          required
        />

        <div>
          <Input
            label="Password"
            type="password"
            value={createForm.password}
            onChange={(e) => {
              setCreateForm({ ...createForm, password: e.target.value });
              validatePassword(e.target.value);
            }}
            placeholder="Min. 8 characters"
            required
          />
          {createForm.password && (
            <div className="mt-2">
              <PasswordChecklist rules={passwordValidation} />
            </div>
          )}
        </div>

        <Select
          value={createForm.roleId}
          onChange={(val) =>
            setCreateForm({ ...createForm, roleId: val })
          }
          options={roleOptions}
          placeholder="Select role"
        />
        <Select
          value={createForm.tenantId}
          onChange={(val) =>
            setCreateForm({ ...createForm, tenantId: val })
          }
          options={tenantOptions}
          placeholder="Select tenant"
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Create User
          </Button>
        </div>
      </div>
    </form>
  );
};
