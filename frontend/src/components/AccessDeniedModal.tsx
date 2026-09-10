"use client";

import React from "react";
import { AlertTriangle, X, User, Shield } from "lucide-react";
import { Button } from "@/components/ui";

interface AccessDeniedModalProps {
  isOpen: boolean;
  userName?: string;
  onClose: () => void;
  onRedirectToProfile: () => void;
}

const AccessDeniedModal: React.FC<AccessDeniedModalProps> = ({
  isOpen,
  userName,
  onClose,
  onRedirectToProfile,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="bg-card rounded-2xl shadow-2xl overflow-hidden">
          {/* Icon */}
          <div className="flex justify-center pt-8 pb-4">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
          </div>

          {/* Content */}
          <div className="px-6 pb-6">
            <h2 className="text-xl font-bold text-foreground text-center mb-2">
              Access Restricted
            </h2>

            <p className="text-sm text-muted-foreground text-center mb-4">
              Hello{" "}
              <span className="font-semibold text-foreground">
                {userName || "User"}
              </span>
              , you don&apos;t have permission to access this page.
            </p>

            <div className="bg-muted rounded-lg p-3 mb-5 shadow-sm">
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <div className="text-sm text-muted-foreground">
                  To request access for this feature, please visit your{" "}
                  <strong className="text-foreground">
                    Profile Settings
                  </strong>{" "}
                  and contact your administrator.
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="primary"
                className="flex-1"
                onClick={onRedirectToProfile}
              >
                <User className="w-4 h-4" />
                Go to Profile
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                onClick={onClose}
              >
                Go Back
              </Button>
            </div>
          </div>

          {/* Close button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AccessDeniedModal;
