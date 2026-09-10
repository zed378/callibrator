// src/app/dashboard/session-management/components/SessionRowHelpers.ts
export interface Session {
  id: string;
  userId: string;
  username: string;
  email: string;
  device: string;
  browser: string;
  ipAddress: string;
  userAgent: string;
  os: string;
  role: string;
  tenantName?: string | null;
  createdAt: string;
  lastActivityAt: string;
  expiredAt: string;
  status: string;
  isRevoked?: boolean;
  revokedReason?: string | null;
  isCurrentSession?: boolean;
}

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
