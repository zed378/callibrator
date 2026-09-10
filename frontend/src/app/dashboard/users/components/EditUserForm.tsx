import React from "react";
import { Input, Badge, Select, Button } from "@/components/ui";
import { CheckCircle, XCircle } from "lucide-react";
import type { User } from "@/types";

interface EditFormProps {
  editingUser: User | null;
  editForm: {
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    status: string;
  };
  setEditForm: React.Dispatch<
    React.SetStateAction<{
      username: string;
      firstName: string;
      lastName: string;
      email: string;
      status: string;
    }>
  >;
  formError: string;
  isSubmitting: boolean;
  usernameAvailability: {
    checking: boolean;
    available: boolean | null;
  };
  checkUsernameAvailability: (
    username: string,
    isEditing?: boolean,
    existingUsername?: string,
  ) => void;
  statusOptions: { value: string; label: string }[];
  onSubmit: (e: React.FormEvent) => void;
}

export const EditUserForm: React.FC<EditFormProps> = ({
  editingUser,
  editForm,
  setEditForm,
  formError,
  isSubmitting,
  usernameAvailability,
  checkUsernameAvailability,
  statusOptions,
  onSubmit,
}) => {
  if (!editingUser) return null;

  return (
    <form onSubmit={onSubmit}>
      <div className="space-y-4">
        {formError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
            {formError}
          </div>
        )}

        <Input
          label="First Name"
          value={editForm.firstName}
          onChange={(e) =>
            setEditForm({ ...editForm, firstName: e.target.value })
          }
          placeholder="John"
          required
        />
        <Input
          label="Last Name"
          value={editForm.lastName}
          onChange={(e) =>
            setEditForm({ ...editForm, lastName: e.target.value })
          }
          placeholder="Doe"
          required
        />
        <Input
          label="Username"
          value={editForm.username}
          onChange={(e) => {
            setEditForm({ ...editForm, username: e.target.value });
            checkUsernameAvailability(
              e.target.value,
              true,
              editingUser.username || undefined,
            );
          }}
          placeholder="johndoe"
          required
        />
        <div
          className={`space-y-1 transition-all duration-1000 overflow-hidden ${
            editForm.username
              ? "max-h-25 opacity-100"
              : "max-h-0 opacity-0"
          }`}
        >
          {usernameAvailability.checking && (
            <div className="flex items-center gap-2 text-primary">
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span>Checking availability...</span>
            </div>
          )}
          {!usernameAvailability.checking &&
            usernameAvailability.available === false && (
              <div className="flex items-center gap-2 text-destructive">
                <XCircle className="h-4 w-4" />
                <span>Username is already taken</span>
              </div>
            )}
          {!usernameAvailability.checking &&
            usernameAvailability.available === true && (
              <div className="flex items-center gap-2 text-success">
                <CheckCircle className="h-4 w-4" />
                <span>Username is available</span>
              </div>
            )}
        </div>
        <Input
          label="Email"
          type="email"
          value={editForm.email}
          disabled
          placeholder="john@hospital.com"
        />
        <Select
          value={editForm.status}
          onChange={(val) => setEditForm({ ...editForm, status: val })}
          options={statusOptions}
          placeholder="Select status"
          className="w-full"
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="submit"
            variant="primary"
            isLoading={isSubmitting}
          >
            Update User
          </Button>
        </div>
      </div>
    </form>
  );
};
