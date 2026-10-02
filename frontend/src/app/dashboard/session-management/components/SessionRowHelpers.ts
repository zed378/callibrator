// src/app/dashboard/session-management/components/SessionRowHelpers.ts
import type { Session as ApiSession } from "@/api/services/session.service";

/** A row: the contract's AdminSession (P9-25; it replaced a hand-written copy). */
export type Session = ApiSession & { isCurrentSession?: boolean };

export const isSessionExpired = (expiredAt: string): boolean =>
  new Date(expiredAt) < new Date();

export const getTimeAgo = (dateString: string): string => {
  const seconds = Math.floor(
    (Date.now() - new Date(dateString).getTime()) / 1000,
  );
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};
