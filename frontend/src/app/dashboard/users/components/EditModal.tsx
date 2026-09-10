import React from "react";
import type { User } from "@/types";
import { Button } from "@/components/ui";
import { Input, Select, Alert } from "@/components/ui";
import { User as UserIcon, Mail, Camera } from "lucide-react";
import { UsernameAvailability } from "./UsernameAvailability";
import Image from "next/image";
import { toSameOriginUpload } from "@/lib/uploadUrl";

interface EditModalProps {
  show: boolean;
  onClose: () => void;
  user: User | null;
  form: {
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    status: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      firstName: string;
      lastName: string;
      username: string;
      email: string;
      status: string;
    }>
  >;
  error: string;
  submitting: boolean;
  usernameAvailability: { checking: boolean; available: boolean | null };
  checkUsername: (
    username: string,
    isEditing?: boolean,
    existing?: string,
  ) => void;
  statusOptions: { value: string; label: string }[];
  onSubmit: (e: React.FormEvent) => void;
  picture: string;
  setPicture: React.Dispatch<React.SetStateAction<string>>;
  onPictureChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearPicture: () => void;
}

export const EditModal: React.FC<EditModalProps> = ({
  show,
  onClose,
  user,
  form,
  setForm,
  error,
  submitting,
  usernameAvailability,
  checkUsername,
  statusOptions,
  onSubmit,
  picture,
  setPicture,
  onPictureChange,
  onClearPicture,
}) => {
  if (!show || !user) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-card rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-bold text-foreground">
            Edit User
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="First Name"
                value={form.firstName}
                onChange={(e) =>
                  setForm({ ...form, firstName: e.target.value })
                }
                placeholder="John"
              />
              <Input
                label="Last Name"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                placeholder="Doe"
              />
            </div>
            {/* Picture Upload */}
            <div className="flex items-center gap-4">
              <label className="block text-sm font-medium text-foreground">
                Picture
              </label>
              <div className="flex items-center gap-3 flex-1">
                {picture ? (
                  <div className="relative group">
                    <Image
                      src={toSameOriginUpload(picture)}
                      alt={user?.username || "User"}
                      width={64}
                      height={64}
                      className="w-16 h-16 rounded-full object-cover border-2 border-primary/50"
                    />
                    <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        type="button"
                        className="bg-white rounded-full p-1.5 shadow-lg hover:bg-muted transition-colors"
                        onClick={onClearPicture}
                      >
                        <Camera className="h-4 w-4 text-primary" />
                      </button>
                    </div>
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

            <div className="flex flex-col gap-2">
              <Input
                label="Username"
                value={form.username}
                onChange={(e) => {
                  setForm({ ...form, username: e.target.value });
                  checkUsername(
                    e.target.value,
                    true,
                    user.username || undefined,
                  );
                }}
                placeholder="johndoe"
                leftIcon={<UserIcon className="h-4 w-4" />}
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
                  isCurrentUsername={form.username === user.username}
                />
              </div>
            </div>
            <Input
              label="Email"
              type="email"
              value={form.email}
              disabled
              placeholder="john@hospital.com"
              leftIcon={<Mail className="h-4 w-4" />}
            />
            <Select
              value={form.status}
              onChange={(val) => setForm({ ...form, status: val })}
              options={statusOptions}
              placeholder="Select status"
              className="w-full"
            />
          </div>
          <div className="flex justify-end gap-3 p-6 border-t border-border">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={submitting}>
              Update User
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
