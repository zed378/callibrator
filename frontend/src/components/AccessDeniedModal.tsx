"use client";

import React from "react";
import { AlertTriangle, X, User, Shield } from "lucide-react";
import { Button } from "@/components/ui";
import { useModalA11y } from "@/components/ui/useModalA11y";

interface AccessDeniedModalProps {
  isOpen: boolean;
  userName?: string;
  /** F-07: the backend's reason for the refusal, when it gave one. */
  message?: string | null;
  onClose: () => void;
  onRedirectToProfile: () => void;
}

const AccessDeniedModal: React.FC<AccessDeniedModalProps> = ({
  isOpen,
  userName,
  message,
  onClose,
  onRedirectToProfile,
}) => {
  // F-12: keyboard-complete like every other dialog.
  const panelRef = useModalA11y<HTMLDivElement>(isOpen, onClose);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="access-denied-title"
        aria-describedby="access-denied-description"
        tabIndex={-1}
        className="relative z-10 w-full max-w-md mx-4 focus:outline-none"
      >
        <div className="bg-card rounded-2xl shadow-2xl overflow-hidden">
          {/* Icon */}
          <div className="flex justify-center pt-8 pb-4">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
          </div>

          {/* Content */}
          <div className="px-6 pb-6">
            <h2
              id="access-denied-title"
              className="text-xl font-bold text-foreground text-center mb-2"
            >
              Access Restricted
            </h2>

            <p
              id="access-denied-description"
              className="text-sm text-muted-foreground text-center mb-4"
            >
              Hello{" "}
              <span className="font-semibold text-foreground">
                {userName || "User"}
              </span>
              , you don&apos;t have permission to do that.
              {message && (
                <span className="block mt-2 text-foreground">{message}</span>
              )}
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
            aria-label="Close"
            className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AccessDeniedModal;
