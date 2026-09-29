-- P8-07 (ADR-086) volume seed: 2 tenants x 5,000 devices, 5 years of records, 4.32M iot_readings,
-- 1M audit_logs. Scratch databases only. Run after the demo seed.
\timing on
-- one HEALTHCARE ADMIN per load tenant, copied from the seeded demo admin (password Demo123!)
INSERT INTO users (id, username, tenant_id, role_id, email, password, first_name, last_name, phone, avatar_url, is_active, status,
  is_email_verified, failed_login_attempts, mfa_enabled, must_change_password, webauthn_enabled, is_deleted, created_at, updated_at)
SELECT gen_random_uuid(), 'load_' || t.subdomain, t.id, u.role_id, 'load@' || t.subdomain || '.test', u.password, 'Load', t.subdomain,
  u.phone, u.avatar_url, true, 'ACTIVE', true, 0, false, false, false, false, now(), now()
FROM tenants t CROSS JOIN (SELECT * FROM users WHERE email = 'demo.healtcare_admin@demo.callibrator.test') u
WHERE t.subdomain IN ('demo-alpha', 'demo-beta');

-- 5,000 devices per tenant; serial prefix names the tenant, so a leak is visible in any row
INSERT INTO calibration_devices (id, tenant_id, name, serial_number, manufacturer, model, category, status,
  installation_date, next_calibration_date, calibration_interval_days, iot_enabled, is_deleted, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'Device ' || lpad(g::text, 5, '0'), upper(t.code) || '-' || g, 'Maker ' || (g % 20), 'M' || (g % 50),
  (ARRAY['infusion','ventilator','monitor','defibrillator','scale'])[1 + g % 5], 'active',
  now() - interval '6 years', now() + ((g % 400) - 30) * interval '1 day', 365, g <= 1000, false, now(), now()
FROM tenants t CROSS JOIN generate_series(1, 5000) g WHERE t.subdomain IN ('demo-alpha', 'demo-beta');

-- five years of history: two records a year per device = 50,000 per tenant
INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, due_date, standard, results,
  measurement_uncertainty, is_compliant, is_deleted, created_at, updated_at)
SELECT gen_random_uuid(), d.tenant_id, d.id, u.id, now() - k * interval '182 days', now() - (k - 2) * interval '182 days',
  'ISO 17025', '{"points":[{"ref":10,"meas":10.01}]}'::jsonb, 0.02, (k % 7) <> 0, false, now(), now()
FROM calibration_devices d JOIN users u ON u.tenant_id = d.tenant_id AND u.email LIKE 'load@%'
CROSS JOIN generate_series(1, 10) k WHERE d.serial_number ~ '^DEMO[AB]-';

-- iot: the 1,000 iot-enabled devices per tenant, hourly for 90 days = 2.16M per tenant
INSERT INTO iot_readings (id, tenant_id, device_id, timestamp, metrics, is_anomaly, created_at)
SELECT gen_random_uuid(), d.tenant_id, d.id, now() - h * interval '1 hour', jsonb_build_object('temperature', 20 + (h % 10)), h % 997 = 0, now()
FROM calibration_devices d CROSS JOIN generate_series(1, 2160) h WHERE d.iot_enabled AND d.serial_number ~ '^DEMO[AB]-';

-- audit: 500,000 rows per tenant over five years
INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, actor_name, action, resource_type, resource_id, created_at)
SELECT gen_random_uuid(), u.tenant_id, u.id, 'user', NULL,
  (enum_range(NULL::enum_audit_logs_action))[1 + g % 3], 'calibration_device', g::text, now() - (g % 1825) * interval '1 day'
FROM users u CROSS JOIN generate_series(1, 500000) g WHERE u.email LIKE 'load@%';

ANALYZE;
SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE relname IN ('calibration_devices','calibration_records','iot_readings','audit_logs') ORDER BY 1;
