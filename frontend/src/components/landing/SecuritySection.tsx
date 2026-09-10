"use client";

import React from "react";
import {
  Lock,
  Server,
  FileCheck2,
  Database,
  Eye,
  KeyRound,
} from "lucide-react";

interface SecurityItem {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export const SecuritySection = () => {
  const securityPoints: SecurityItem[] = [
    {
      icon: <Lock className="w-7 h-7" />,
      title: "End-to-End Encryption",
      description:
        "All data encrypted at rest and in transit using AES-256 encryption. TLS 1.3 ensures secure communication between all system components and user sessions.",
    },
    {
      icon: <KeyRound className="w-7 h-7" />,
      title: "OIDC Authentication & MFA",
      description:
        "Industry-standard OpenID Connect authentication with multi-factor authentication support. SSO integration with existing identity providers for seamless secure access.",
    },
    {
      icon: <Server className="w-7 h-7" />,
      title: "Multi-Tenant Isolation",
      description:
        "Strict data isolation between tenants at the database level. Each healthcare facility's data remains completely separate with no cross-contamination risk.",
    },
    {
      icon: <FileCheck2 className="w-7 h-7" />,
      title: "Complete Audit Trail",
      description:
        "Every action logged with before/after state tracking, user attribution, timestamps, and IP addresses. Immutable audit logs meeting regulatory retention requirements.",
    },
    {
      icon: <Database className="w-7 h-7" />,
      title: "Automated Backups & DR",
      description:
        "Daily encrypted backups with 30-day retention and cross-region replication. Point-in-time recovery capabilities and quarterly disaster recovery drills ensure business continuity.",
    },
    {
      icon: <Eye className="w-7 h-7" />,
      title: "Real-Time Monitoring",
      description:
        "Comprehensive monitoring with Slack/PagerDuty integrations for critical events. Health checks, performance metrics, and security dashboards for complete operational visibility.",
    },
  ];

  return (
    <section
      id="security"
      className="relative py-32 overflow-hidden bg-muted"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border mb-6 bg-success/10 border-success/30">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="text-sm font-medium text-success">
              Security
            </span>
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold mb-6 text-foreground">
            Enterprise-Grade
            <br />
            <span className="bg-linear-to-r from-success to-info bg-clip-text text-transparent">
              Security & Compliance
            </span>
          </h2>
          <p className="text-lg max-w-2xl mx-auto text-muted-foreground">
            Built from the ground up with security and compliance as first
            class citizens. Your patient and device data is protected by
            military-grade encryption and industry best practices.
          </p>
        </div>

        {/* Security grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {securityPoints.map((point, index) => (
            <div
              key={index}
              className="group p-8 rounded-3xl transition-all duration-500 transform hover:-translate-y-2 bg-white hover:bg-muted shadow-sm border border-border/40 h-full flex flex-col"
            >
              <div className="w-14 h-14 bg-linear-to-br from-success to-info rounded-2xl flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-all duration-300 text-white">
                {point.icon}
              </div>
              <h3 className="text-lg font-semibold mb-3 text-foreground">
                {point.title}
              </h3>
              <p className="leading-relaxed text-muted-foreground text-sm flex-1">
                {point.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default SecuritySection;
