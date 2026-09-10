"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Loader2, Lock, Shield } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { userService } from "@/api/services/user.service";
import { Button, Card } from "@/components/ui";
import { CurrentPasswordField } from "./components/CurrentPasswordField";
import { NewPasswordField } from "./components/NewPasswordField";
import { ConfirmPasswordField } from "./components/ConfirmPasswordField";
import { SuccessMessage, FormError } from "./components/Messages";

interface PasswordValidation {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
}

export default function ChangePasswordPage() {
  const { user, fetchUser } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwStatus, setPwStatus] = useState<
    "idle" | "validating" | "valid" | "invalid"
  >("idle");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (!currentPw?.trim()) {
      setTimeout(() => setPwStatus("idle"), 0);
      return;
    }
    let cancelled = false;
    setTimeout(() => setPwStatus("validating"), 0);
    debounceTimerRef.current = setTimeout(async () => {
      try {
        // The endpoint answers 200 for a wrong password too, so the verdict
        // must come from the returned flag — not merely from "it didn't throw".
        const { valid } = await userService.verifyCurrentPassword(currentPw);
        if (cancelled) return;
        setPwStatus(valid ? "valid" : "invalid");
      } catch {
        if (!cancelled) setPwStatus("invalid");
      }
    }, 600);
    return () => {
      // Guard against a slow in-flight check landing after newer input.
      cancelled = true;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [currentPw]);

  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(""), 3000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  useEffect(() => {
    const load = async () => {
      if (!user) {
        try {
          await fetchUser();
        } catch {
          /* */
        }
      }
      setIsLoading(false);
    };
    load();
  }, [user, fetchUser]);

  const handleSubmit = useCallback(async () => {
    if (!user) return;
    const e: Record<string, string> = {};
    if (!currentPw) e.currentPassword = "Current password is required";
    if (!newPw) {
      e.newPassword = "New password is required";
    } else {
      const v: PasswordValidation = {
        minLength: newPw.length >= 8,
        hasUppercase: /[A-Z]/.test(newPw),
        hasLowercase: /[a-z]/.test(newPw),
        hasNumber: /[0-9]/.test(newPw),
        hasSymbol: /[!@#$%^&*(),.?":{}|<>]/.test(newPw),
      };
      if (Object.values(v).filter(Boolean).length < 3)
        e.newPassword = "Password is too weak";
    }
    if (newPw !== confirmPw) e.confirmPassword = "Passwords do not match";
    if (Object.keys(e).length > 0) {
      setErrors(e);
      return;
    }

    setErrors({});
    setIsSaving(true);
    try {
      await userService.changePassword({
        currentPassword: currentPw,
        newPassword: newPw,
      });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setSuccessMsg("Password changed successfully!");
    } catch (err) {
      // Surface the server's reason (e.g. "Current password is incorrect")
      // rather than a generic failure.
      setErrors({
        currentPassword:
          err instanceof Error && err.message
            ? err.message
            : "Failed to change password",
      });
    } finally {
      setIsSaving(false);
    }
  }, [user, currentPw, newPw, confirmPw]);

  if (isLoading)
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </DashboardLayout>
    );

  if (!user)
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            Please log in to change your password.
          </p>
        </div>
      </DashboardLayout>
    );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Change Password
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Update your password to keep your account secure.
            </p>
          </div>
        </div>

        {successMsg && <SuccessMessage message={successMsg} />}
        {errors._form && <FormError message={errors._form} />}

        <Card className="md:max-w-150 px-6 py-7 border border-border">
          <div className="space-y-5">
            <h2 className="text-base font-semibold mb-5 flex items-center gap-2 text-foreground">
              <Shield className="w-5 h-5 text-foreground" />
              Security
            </h2>
            <CurrentPasswordField
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              error={errors.currentPassword}
              status={pwStatus}
            />
            <NewPasswordField
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              error={errors.newPassword}
            />
            <ConfirmPasswordField
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              error={errors.confirmPassword}
              matchStatus={
                !confirmPw
                  ? "idle"
                  : confirmPw === newPw
                    ? "match"
                    : "mismatch"
              }
            />
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSubmit}
                disabled={isSaving}
                className="gap-2"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                {isSaving ? "Changing..." : "Change Password"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
