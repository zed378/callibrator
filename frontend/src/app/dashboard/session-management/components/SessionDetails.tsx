// src/app/dashboard/session-management/components/SessionDetails.tsx
"use client";

import React from "react";
import {
  Key,
  MapPin,
  Globe,
  Calendar,
  Shield,
  Cpu,
  CheckCircle,
  Clock,
  AlertTriangle,
  Monitor,
} from "lucide-react";
import { Session, getTimeAgo } from "./SessionRowHelpers";

interface SessionDetailsProps {
  session: Session;
  isRevoked: boolean;
  expired: boolean;
}

export const SessionDetails: React.FC<SessionDetailsProps> = ({
  session,
  isRevoked,
  expired,
}) => {
  const detailIcon = "w-4 h-4 text-muted-foreground";

  const detailsList = [
    {
      icon: <Key className={detailIcon} />,
      label: "Session ID",
      value: session.id,
      mono: true,
    },
    {
      icon: <MapPin className={detailIcon} />,
      label: "IP Address",
      value: session.ipAddress,
      mono: true,
    },
    {
      icon: <Globe className={detailIcon} />,
      label: "User Agent",
      value: session.userAgent,
      truncate: true,
    },
    {
      icon: <Calendar className={detailIcon} />,
      label: "Created",
      value: getTimeAgo(session.createdAt),
    },
    {
      icon: <Shield className={detailIcon} />,
      label: "Role",
      value: session.role,
    },
    {
      icon: <Cpu className={detailIcon} />,
      label: "OS",
      value: session.os,
    },
    {
      icon: (
        <CheckCircle
          className={`w-4 h-4 ${isRevoked ? "text-muted-foreground" : expired ? "text-destructive" : "text-success"}`}
        />
      ),
      label: "Status",
      value: isRevoked ? "Revoked" : expired ? "Expired" : "Active",
      color: isRevoked ? "text-muted-foreground" : expired ? "text-destructive" : "text-success",
    },
    {
      icon: <Clock className={detailIcon} />,
      label: "Expires",
      value: getTimeAgo(session.expiredAt),
    },
  ];

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {detailsList.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            {item.icon}
            <div>
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p
                className={`text-sm ${item.mono ? "font-mono" : ""} ${item.truncate ? "truncate max-w-xs" : ""} ${item.color || "text-foreground"}`}
              >
                {item.value}
              </p>
            </div>
          </div>
        ))}
        {session.revokedReason && (
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <div>
              <p className="text-xs text-muted-foreground">Revocation Reason</p>
               <p className="text-sm text-foreground">{session.revokedReason}</p>
            </div>
          </div>
        )}
        {session.tenantName && (
          <div className="flex items-center gap-2">
            <Monitor className={detailIcon} />
            <div>
              <p className="text-xs text-muted-foreground">Tenant</p>
              <p className="text-sm text-foreground">{session.tenantName}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SessionDetails;
