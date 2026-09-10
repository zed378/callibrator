// src/app/dashboard/session-management/components/SessionRow.tsx
"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui";
import {
  LogOut,
  Trash2,
  ChevronDown,
  Shield,
  Clock,
  Monitor,
  UserCheck,
} from "lucide-react";
import { Session, isSessionExpired, getTimeAgo } from "./SessionRowHelpers";
import SessionDetails from "./SessionDetails";

interface SessionRowProps {
  session: Session;
  onRevoke: (id: string) => void;
  onDelete: (id: string) => void;
}

const SessionRow: React.FC<SessionRowProps> = ({
  session,
  onRevoke,
  onDelete,
}) => {
  const [expanded, setExpanded] = useState(false);
  const expired = session.status === "expired" || isSessionExpired(session.expiredAt);
  const isRevoked = session.status === "revoked" || session.isRevoked;

  const statusIcon = session.isCurrentSession ? (
    <Monitor className="w-5 h-5 text-primary" />
  ) : isRevoked ? (
    <Shield className="w-5 h-5 text-muted-foreground" />
  ) : expired ? (
    <Clock className="w-5 h-5 text-destructive" />
  ) : (
    <UserCheck className="w-5 h-5 text-success" />
  );

  const statusBadge = session.isCurrentSession
    ? "bg-primary/10 text-primary"
    : isRevoked
      ? "bg-muted text-foreground0/20"
      : expired
        ? "bg-destructive/10 text-destructive"
        : "";

  return (
    <div className="rounded-xl overflow-hidden transition-all shadow-sm hover:shadow-md">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div
              className={`relative flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                session.isCurrentSession
                  ? "bg-primary/20"
                  : isRevoked
                    ? "bg-muted0/10"
                    : expired
                      ? "bg-destructive/10"
                      : "bg-success/10"
              }`}
            >
              {statusIcon}
              {session.isCurrentSession && (
                <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-primary rounded-full border-2 border-white animate-pulse" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground">
                  {session.username}
                </p>
                {session.isCurrentSession && (
                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${statusBadge}`}>
                    CURRENT
                  </span>
                )}
                {isRevoked && (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-muted text-foreground0/20">
                    REVOKED
                  </span>
                )}
                {expired && !isRevoked && (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-destructive/10 text-destructive">
                    EXPIRED
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{session.email}</p>
            </div>
            <div className="hidden md:flex items-center gap-6">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Device</p>
                  <p className="text-sm font-medium text-foreground">{session.device}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Browser</p>
                  <p className="text-sm font-medium text-foreground">{session.browser}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">IP</p>
                  <p className="text-sm font-medium text-foreground">{session.ipAddress}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-muted-foreground">Last Active</p>
                  <p className="text-sm font-medium text-foreground">
                  {getTimeAgo(session.lastActivityAt)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {!isRevoked && !expired && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRevoke(session.id)}
                  title="Revoke Session"
                >
                  <LogOut className="w-4 h-4 text-destructive" />
                </Button>
              )}
              {(isRevoked || expired) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(session.id)}
                  title="Delete Session"
                >
                  <Trash2 className="w-4 h-4 text-warning" />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
              </Button>
            </div>
          </div>
        </div>
        {expanded && (
          <SessionDetails session={session} isRevoked={isRevoked || false} expired={expired} />
        )}
      </div>
    </div>
  );
};

export default SessionRow;
