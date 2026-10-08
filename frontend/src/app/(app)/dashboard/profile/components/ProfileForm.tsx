"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { userService } from "@/api/services/user.service";
import { User as UserType } from "@/types";
import { Button, Input } from "@/components/ui";
import { Loader2, Save, CheckCircle, XCircle } from "lucide-react";

interface ProfileFormProps {
  user: UserType;
  fetchUser: () => Promise<void>;
  errors: Record<string, string>;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  successMessage: string;
  setSuccessMessage: React.Dispatch<React.SetStateAction<string>>;
}

const ProfileForm: React.FC<ProfileFormProps> = ({
  user,
  fetchUser,
  errors,
  setErrors,
  successMessage,
  setSuccessMessage,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [username, setUsername] = useState(user?.username || "");
  const [email, setEmail] = useState(user?.email || "");
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "unavailable"
  >("idle");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);



  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!username?.trim() || !user) {
      const timer = setTimeout(() => {
        setUsernameStatus("idle");
      }, 0);
      return () => clearTimeout(timer);
    }

    const checkTimer = setTimeout(() => {
      setUsernameStatus("checking");
    }, 0);

    const timer = setTimeout(async () => {
      if (user && username === user.username) {
        setUsernameStatus("idle");
        return;
      }
      try {
        const res = await userService.checkUsername(username);
        setUsernameStatus(res.available ? "available" : "unavailable");
      } catch {
        setUsernameStatus("idle");
      }
    }, 500);

    debounceTimerRef.current = timer;

    return () => {
      clearTimeout(checkTimer);
      clearTimeout(timer);
    };
  }, [username, user]);

  const handleSave = useCallback(async () => {
    if (!user) return;
    const newErrors: Record<string, string> = {};
    if (!firstName?.trim()) newErrors.firstName = "First name is required";
    if (!lastName?.trim()) newErrors.lastName = "Last name is required";
    if (!username?.trim()) {
      newErrors.username = "Username is required";
    } else if (usernameStatus === "unavailable") {
      newErrors.username = "Username is already taken";
    }
    if (!email?.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "Invalid email format";
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setIsSaving(true);
    try {
      await userService.updateProfile({
        userId: user.id,
        firstName,
        lastName,
        username: username.trim().toLowerCase(),
      });
      await fetchUser();
      setSuccessMessage("Profile updated successfully!");
    } catch {
      setErrors({ _form: "Failed to update profile" });
    } finally {
      setIsSaving(false);
    }
  }, [user, firstName, lastName, username, email, usernameStatus, fetchUser, setErrors]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="First Name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          error={errors.firstName}
          placeholder="Enter first name"
        />
        <Input
          label="Last Name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          error={errors.lastName}
          placeholder="Enter last name"
        />
      </div>
      <div className="relative">
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={errors.username}
          placeholder="Enter username"
        />
        {usernameStatus === "checking" && (
          <div className="absolute right-3 top-[34px]">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
          </div>
        )}
        {usernameStatus === "available" && (
          <div className="absolute right-3 top-[34px]">
            <CheckCircle className="w-4 h-4 text-success" />
          </div>
        )}
        {usernameStatus === "unavailable" && (
          <div className="absolute right-3 top-[34px]">
            <XCircle className="w-4 h-4 text-destructive" />
          </div>
        )}
      </div>
      {usernameStatus === "checking" && (
        <div className="text-xs text-primary flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          Checking username availability...
        </div>
      )}
      {usernameStatus === "available" && (
        <div className="text-xs text-success flex items-center gap-1.5">
          <CheckCircle className="w-3 h-3" />
          Username is available
        </div>
      )}
      {usernameStatus === "unavailable" && (
        <div className="text-xs text-destructive flex items-center gap-1.5">
          <XCircle className="w-3 h-3" />
          Username is already taken
        </div>
      )}
      <Input
        label="Email"
        type="email"
        value={email}
        disabled
        placeholder="Email cannot be changed"
      />
      <div className="flex justify-end pt-2">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="gap-2"
          leftIcon={isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
};

export default ProfileForm;
