# Blockers & Technical Debt

Active issues, architectural concerns, and known limitations.

## High Priority

### None currently identified

---

## Medium Priority

### Database Performance at Scale
**Issue:** Row-level audit logging may cause write performance degradation at scale.

**Mitigation:**
- Audit tables use separate schema and indexes
- Write batching for non-critical operations
- Read replicas for audit queries
- Performance testing at 100k records/day

**Status:** Monitor in Phase 2

---

### Session State Size
**Issue:** Redis session cache memory usage may grow with large user base.

**Mitigation:**
- Session compression using msgpack
- Aggressive session TTL (15 min access token, 7 day refresh)
- Regular cleanup of expired sessions
- Monitoring and alerting on memory usage

**Status:** Monitor in Phase 3

---

### Calibration Record Storage
**Issue:** Immutable append-only calibration records accumulate storage over time.

**Mitigation:**
- Archive old records (>1 year) to cold storage
- Aggregated "current state" views for operational queries
- Partitioned tables by date for efficiency
- Storage capacity planning: 50GB/year baseline, scale with device count

**Status:** Address in Phase 4

---

## Low Priority

### Frontend Build Performance
**Issue:** Next.js builds may slow as app grows.

**Mitigation:**
- Turbo caching for incremental builds
- Lazy route loading for admin panel
- Code splitting by feature module
- Monitoring: <3 min build time threshold

**Status:** Optimize in Phase 4

---

### Certificate Signature Performance
**Issue:** RSA-2048 signing for every certificate may be bottleneck.

**Mitigation:**
- Batch certificate signing during off-peak hours
- Hardware security module (HSM) for production
- Caching strategy for frequently-regenerated certs
- Load test: <100ms per signature target

**Status:** Test in Phase 3

---

## Deferred Decisions

### Third-Party Integrations (Phase 4)
- Vault for secrets management
- DataDog or similar for observability
- SMS gateway provider (Twilio, AWS SNS)
- Email service (SendGrid, AWS SES)

### Advanced Analytics (Phase 5)
- Data lake technology (Snowflake, BigQuery)
- ML models for predictive maintenance
- Real-time dashboards (Grafana, Kibana)

---

## Compliance Notes

### IDOR (Insecure Direct Object References)
**Status:** Zero tolerance policy. Every `:id` endpoint must validate tenant isolation.

**Verification:**
- Automated tests in CI/CD
- Manual security review before merge
- Quarterly penetration testing

### Data Encryption
**Current:** Data in transit (TLS 1.3), at rest (PostgreSQL native encryption in Kubernetes)

**Future:** Hardware security modules for key management (Phase 4)

### Audit Trail Completeness
**Requirement:** 100% of data mutations logged with before/after state.

**Implementation:** Triggers at database level + application-level logging for redundancy.

---

## Update Frequency

Review blockers list:
- After each phase completion
- When new issues discovered
- Monthly during active development
- Quarterly before release

Document resolution in MEMORY/records/ with corresponding task ID.
