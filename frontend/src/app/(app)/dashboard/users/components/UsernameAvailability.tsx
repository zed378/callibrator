import React from "react";
import { CheckCircle, XCircle, Loader2, AlertCircle } from "lucide-react";

interface UsernameAvailabilityProps {
  checking: boolean;
  available: boolean | null;
  username: string;
  isCurrentUsername?: boolean;
}

export const UsernameAvailability: React.FC<UsernameAvailabilityProps> = ({
  checking,
  available,
  username,
  isCurrentUsername = false,
}) => {
  // Show checking spinner while API call is in progress
  if (checking) {
    return (
      <div className="flex items-center gap-2 text-primary">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Checking availability...</span>
      </div>
    );
  }

  // Show result when API call completes
  if (available === false) {
    return (
      <div className="flex items-center gap-2 text-destructive">
        <XCircle className="h-4 w-4" />
        <span>Username is already taken</span>
      </div>
    );
  }

  if (available === true) {
    if (isCurrentUsername) {
      return (
        <div className="flex items-center gap-2 text-info">
          <CheckCircle className="h-4 w-4" />
          <span>This is your current username</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 text-success">
        <CheckCircle className="h-4 w-4" />
        <span>Username is available</span>
      </div>
    );
  }

  // When available is null, API hasn't returned a result yet
  if (available === null) {
    // Only show hint when username field is empty
    if (username.length === 0) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span>Enter a username to check availability</span>
        </div>
      );
    }

    if (username.length > 0 && username.length < 3) {
      return (
        <div className="flex items-center gap-2 text-warning">
          <AlertCircle className="h-4 w-4" />
          <span>Username must be at least 3 characters</span>
        </div>
      );
    }

    // Username has 3+ chars but no result yet - don't show anything, wait for API
    return null;
  }

  // Username has value but no result yet (shouldn't normally appear, but safety fallback)
  return (
    <div className="flex items-center gap-2 text-warning">
      <AlertCircle className="h-4 w-4" />
      <span>Unable to check availability. Please try again.</span>
    </div>
  );
};
