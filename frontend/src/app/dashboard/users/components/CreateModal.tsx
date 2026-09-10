// src/app/dashboard/users/components/CreateModal.tsx
"use client";

import React from "react";
import { Button, Input, Select, Alert } from "@/components/ui";
import { User as UserIcon, Mail, Camera } from "lucide-react";
import { UsernameAvailability } from "./UsernameAvailability";
import PasswordChecklist from "./PasswordChecklist";
import Image from "next/image";
import { toSameOriginUpload } from "@/lib/uploadUrl";

interface CreateModalProps {
  show: boolean;
  onClose: () => void;
  form: {
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    password: string;
    roleId: string;
    tenantId: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      firstName: string;
      lastName: string;
      username: string;
      email: string;
      password: string;
      roleId: string;
      tenantId: string;
    }>
  >;
  error: string;
  submitting: boolean;
  usernameAvailability: { checking: boolean; available: boolean | null };
  checkUsername: (username: string) => void;
  validatePassword: (pw: string) => void;
  rules: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSymbol: boolean;
  };
  roleOptions: { value: string; label: string }[];
  tenantOptions: { value: string; label: string }[];
  onSubmit: (e: React.FormEvent) => void;
  picture: string;
  setPicture: React.Dispatch<React.SetStateAction<string>>;
  onPictureChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const CreateModal: React.FC<CreateModalProps> = ({
  show,
  onClose,
  form,
  setForm,
  error,
  submitting,
  usernameAvailability,
  checkUsername,
  validatePassword,
  rules,
  roleOptions,
  tenantOptions,
  onSubmit,
  picture,
  setPicture,
  onPictureChange,
}) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-card rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold text-foreground">
            Create New User
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="p-6 space-y-4">
            {error && (
              <Alert variant="error" title={error}>
                {error}
              </Alert>
            )}
            {/* Picture Upload */}
            <div className="flex items-center gap-4">
              <label className="block text-sm font-medium text-foreground">
                Picture
              </label>
              <div className="flex items-center gap-3 flex-1">
                {picture ? (
                  <div className="relative">
                    <Image
                      src={toSameOriginUpload(picture)}
                      alt="User preview"
                      width={64}
                      height={64}
                      className="w-16 h-16 rounded-full object-cover border-2 border-primary/50"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 bg-card"
                      onClick={() => setPicture("")}
                    >
                      <Camera className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <label className="cursor-pointer">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center border-2 border-dashed border-border">
                      <UserIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={onPictureChange}
                      className="hidden"
                    />
                  </label>
                )}
                <span className="text-xs text-muted-foreground">
                  {picture ? "Click camera to change" : "Click to upload"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="First Name"
                value={form.firstName}
                onChange={(e) =>
                  setForm({ ...form, firstName: e.target.value })
                }
                placeholder="John"
                required
              />
              <Input
                label="Last Name"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                placeholder="Doe"
                required
              />
            </div>
            <Input
              label="Username"
              value={form.username}
              onChange={(e) => {
                setForm({ ...form, username: e.target.value });
                checkUsername(e.target.value);
              }}
              placeholder="johndoe"
              leftIcon={<UserIcon className="h-4 w-4" />}
              required
            />
            <div
              className={`space-y-1 overflow-hidden transition-all ${
                form.username ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <UsernameAvailability
                checking={usernameAvailability.checking}
                available={usernameAvailability.available}
                username={form.username}
              />
            </div>
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="john@hospital.com"
              leftIcon={<Mail className="h-4 w-4" />}
              required
            />
            <Input
              label="Password"
              type="password"
              value={form.password}
              onChange={(e) => {
                setForm({ ...form, password: e.target.value });
                validatePassword(e.target.value);
              }}
              placeholder="Min. 8 characters"
              required
            />
            <div
              className={`space-y-1 overflow-hidden transition-all ${
                form.password ? "max-h-80 opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <PasswordChecklist rules={rules} />
            </div>
            <Select
              value={form.roleId}
              onChange={(val) => setForm({ ...form, roleId: val })}
              options={roleOptions}
              placeholder="Select a role"
              className="w-full"
            />
            <Select
              value={form.tenantId}
              onChange={(val) => setForm({ ...form, tenantId: val })}
              options={tenantOptions}
              placeholder="Select a tenant"
              className="w-full"
            />
          </div>
          <div className="flex justify-end gap-3 p-6 border-t border-border">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={submitting}>
              Create User
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateModal;
