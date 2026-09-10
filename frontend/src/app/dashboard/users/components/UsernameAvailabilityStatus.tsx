// src/app/dashboard/users/components/UsernameAvailabilityStatus.tsx
import React from "react";
import { CheckCircle, XCircle } from "lucide-react";

interface UsernameAvailabilityStatusProps {
  username: string;
  availability: {
    checking: boolean;
    available: boolean | null;
  };
  isCurrentUsername?: boolean;
}

export const UsernameAvailabilityStatus: React.FC<
  UsernameAvailabilityStatusProps
> = ({ username, availability, isCurrentUsername = false }) => {
  return (
    <div
      className={`space-y-1 transition-all duration-1000 overflow-hidden ${
        username ? "max-h-50 opacity-100" : "max-h-0 opacity-0"
      }`}
    >
      {availability.checking && (
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
      {!availability.checking && availability.available === false && (
        <div className="flex items-center gap-2 text-destructive">
          <XCircle className="h-4 w-4" />
          <span>Username is already taken</span>
        </div>
      )}
      {!availability.checking &&
        availability.available === true &&
        isCurrentUsername && (
          <div className="flex items-center gap-2 text-info">
            <CheckCircle className="h-4 w-4" />
            <span>This is your current username</span>
          </div>
        )}
      {!availability.checking &&
        availability.available === true &&
        !isCurrentUsername && (
          <div className="flex items-center gap-2 text-success">
            <CheckCircle className="h-4 w-4" />
            <span>Username is available</span>
          </div>
        )}
      {!availability.checking &&
        availability.available === null &&
        username.length > 0 && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>Enter a username to check availability</span>
          </div>
        )}
    </div>
  );
};

export default UsernameAvailabilityStatus;
