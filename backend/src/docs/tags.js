/**
 * Swagger Tags
 *
 * Reusable tag definitions grouped by module.
 * Each tag represents an API module with its description.
 */

module.exports = {
  tags: [
    {
      name: "Auth",
      description:
        "Authentication endpoints including registration, login, OTP verification, password reset, and session management",
    },
    {
      name: "Users",
      description:
        "User management endpoints for CRUD operations, role assignment, avatar management, and username availability checks",
    },
    {
      name: "Roles",
      description:
        "Role-based access control (RBAC) endpoints for managing roles, permissions, and role-menu access mapping",
    },
    {
      name: "Permissions",
      description:
        "Granular permission management endpoints for defining module:action permissions",
    },
    {
      name: "MenuGroups",
      description:
        "Menu group management endpoints for organizing navigation structure with hierarchical parent-child relationships",
    },
    {
      name: "Tenants",
      description:
        "Tenant (organization) management endpoints including CRUD, settings, and configuration",
    },
    {
      name: "TenantBackup",
      description:
        "Tenant backup and restore operations including full backups, user-only backups, and schedule management",
    },
    {
      name: "Sessions",
      description:
        "Session management endpoints including user sessions, cleanup, and expiration handling",
    },
    {
      name: "Migration",
      description:
        "Internal migration and seeding operations (development only) for database schema updates and initial data population",
    },
    {
      name: "Stock",
      description:
        "Stock management endpoints for inventory tracking, adjustments, transfers between warehouses, and periodic opname (counting)",
    },
    {
      name: "Warehouse",
      description:
        "Warehouse management endpoints for physical locations and storage locations (shelves, bins, racks)",
    },
    {
      name: "Certificates",
      description:
        "Certificate management endpoints for generating, approving, signing, and revoking calibration certificates (ISO 17025, KARS, SNARS compliance)",
    },
    {
      name: "CalibrationDevices",
      description:
        "Calibration device management endpoints for tracking instruments, their specifications, and calibration schedules",
    },
    {
      name: "CalibrationRecords",
      description:
        "Calibration record management endpoints for recording calibration results, methods, standards, and compliance",
    },
    {
      name: "MeteredBilling",
      description:
        "Metered billing and usage analytics endpoints for tracking resource consumption, cost estimation, and usage alerts",
    },
    {
      name: "CustomDomains",
      description:
        "Custom domain and vanity subdomain management endpoints for DNS configuration and verification",
    },
    {
      name: "GDPR/CCPA",
      description:
        "Data privacy compliance endpoints for GDPR/CCPA including data export, erasure requests, consent management, and processing restrictions",
    },
    {
      name: "TenantHierarchy",
      description:
        "Parent-tenant to child business unit hierarchy management endpoints including tree traversal and cross-tenant role assignments",
    },
    {
      name: "ESignature",
      description:
        "Digital signature workflow management endpoints for 21 CFR Part 11 compliance including key pair generation, workflow management, and signature verification",
    },
    {
      name: "QMS",
      description:
        "Quality Management System endpoints for non-conformances (NC) and corrective/preventive actions (CAPA)",
    },
    {
      name: "SOP",
      description:
        "Standard Operating Procedure endpoints for controlled documents and tenant-wide training acknowledgment",
    },
    {
      name: "Risk",
      description:
        "Risk register endpoints (ISO 14971): risk assessment with severity × likelihood scoring and mitigation tracking",
    },
    {
      name: "SupplierScorecard",
      description:
        "Supplier performance scorecard endpoints for periodic quality/delivery/service evaluation of vendors",
    },
    {
      name: "Maintenance",
      description:
        "Maintenance work-order endpoints (preventive, breakdown, repair) for calibration devices",
    },
    {
      name: "PredictiveMaintenance",
      description:
        "Predictive maintenance endpoints: IoT anomaly analysis and calibration-interval recommendations",
    },
    {
      name: "IoT",
      description:
        "IoT telemetry ingestion endpoints (device-token authenticated) with anomaly detection against reading tolerances",
    },
    {
      name: "AI",
      description:
        "AI assistant endpoints: certificate OCR extraction and retrieval-augmented (RAG) document Q&A",
    },
    {
      name: "FeatureFlags",
      description:
        "Per-tenant feature flag endpoints for evaluating, overriding, and initializing capability toggles",
    },
    {
      name: "TenantLifecycle",
      description:
        "Tenant lifecycle endpoints: suspension, resumption, grace period, offboarding, and data export",
    },
    {
      name: "DataRetention",
      description:
        "Data retention & privacy governance endpoints: retention policies, legal hold, purge, PII masking, and anonymization",
    },
    {
      name: "OIDC",
      description:
        "OpenID Connect provider endpoints: discovery, JWKS, and dynamic client registration/rotation",
    },
    {
      name: "WebAuthn",
      description:
        "WebAuthn / FIDO passwordless endpoints for security-key registration and assertion verification",
    },
    {
      name: "NetworkSecurity",
      description:
        "Network security endpoints: per-tenant IP allowlist (CIDR), geofencing, and login evaluation",
    },
    {
      name: "SCIM",
      description:
        "SCIM 2.0 provisioning endpoints for automated Users and Groups lifecycle from an external IdP",
    },
  ],
};
