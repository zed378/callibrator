"use client";

import React, { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/stores/authStore";
import { userService } from "@/api/services/user.service";
import AvatarUpload from "./components/AvatarUpload";
import ProfileForm from "./components/ProfileForm";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

export default function ProfilePage() {
  const { user, avatarUrl, fetchUser } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState("");

  const handleAvatarUpload = useCallback(async () => {
    try {
      await fetchUser();
    } catch {
      // ignore
    }
  }, [fetchUser]);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const t = setTimeout(() => setSuccessMessage(""), 3000);
      return () => clearTimeout(t);
    }
  }, [successMessage]);

  // Load user data
  useEffect(() => {
    const load = async () => {
      if (!user) {
        try {
          await fetchUser();
        } catch {
          /* */
        } finally {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    };
    load();
  }, [user, fetchUser]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  if (!user) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Please log in to view your profile.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Profile Settings
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Manage your account settings and preferences.
            </p>
          </div>
        </div>

        {successMessage && (
          <div className="p-4 bg-success/10 border border-success/20 rounded-xl text-success text-sm flex items-center gap-3 animate-fade-in">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            {successMessage}
          </div>
        )}

        {errors._form && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm flex items-center gap-3 animate-fade-in">
            <XCircle className="w-5 h-5 flex-shrink-0" />
            {errors._form}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="p-6 bg-muted/50 rounded-2xl shadow-sm border border-border">
            <h2 className="text-base font-semibold text-foreground mb-5">
              Profile Photo
            </h2>
            <AvatarUpload
              user={user}
              avatarUrl={avatarUrl}
              onAvatarUpload={handleAvatarUpload}
              isUploading={isUploading}
              setIsUploading={setIsUploading}
            />
          </div>

          <div className="lg:col-span-2 p-6 bg-muted/50 rounded-2xl shadow-sm border border-border">
            <h2 className="text-base font-semibold text-foreground mb-5">
              Personal Information
            </h2>
            <ProfileForm
              key={user.id}
              user={user}
              fetchUser={fetchUser}
              errors={errors}
              setErrors={setErrors}
              successMessage={successMessage}
              setSuccessMessage={setSuccessMessage}
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
