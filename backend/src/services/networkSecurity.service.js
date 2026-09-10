const { logger } = require("../middlewares/activityLog.middleware");
const { TenantSettings } = require("../models");

const DEFAULT_GEOFENCE_RADIUS_KM = 50;

function isInCidr(ip, cidr) {
  try {
    const [range, prefix] = cidr.split("/");
    const mask = ~(2 ** (32 - parseInt(prefix || "32", 10)) - 1);
    const ipInt = Buffer.from(ip.split(".").map(Number)).readUInt32BE(0);
    const rangeInt = Buffer.from(range.split(".").map(Number)).readUInt32BE(0);
    return (ipInt & mask) === (rangeInt & mask);
  } catch {
    return false;
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getTenantIpAllowlist(tenantId) {
  const setting = await TenantSettings.findOne({
    where: { tenantId, key: "ip_allowlist" },
  });

  if (!setting) {
    return [];
  }

  try {
    return JSON.parse(setting.value || "[]");
  } catch {
    return [];
  }
}

async function setTenantIpAllowlist(tenantId, cidrs) {
  await TenantSettings.upsert({
    tenantId,
    key: "ip_allowlist",
    value: JSON.stringify(cidrs),
  });

  return { tenantId, allowlist: cidrs };
}

async function checkIpAllowlist(tenantId, ip) {
  const allowlist = await getTenantIpAllowlist(tenantId);

  if (allowlist.length === 0) {
    return { allowed: true, reason: "no_restrictions" };
  }

  const allowed = allowlist.some((cidr) => isInCidr(ip, cidr));

  if (!allowed) {
    logger.warn("IP not in allowlist", { tenantId, ip, allowlist });
  }

  return { allowed, ip, allowlist };
}

async function getTenantGeofence(tenantId) {
  const setting = await TenantSettings.findOne({
    where: { tenantId, key: "geofence" },
  });

  if (!setting) {
    return null;
  }

  try {
    return JSON.parse(setting.value || "null");
  } catch {
    return null;
  }
}

async function setTenantGeofence(tenantId, geofence) {
  const payload = {
    latitude: geofence.latitude,
    longitude: geofence.longitude,
    radiusKm: geofence.radiusKm || DEFAULT_GEOFENCE_RADIUS_KM,
  };

  await TenantSettings.upsert({
    tenantId,
    key: "geofence",
    value: JSON.stringify(payload),
  });

  return { tenantId, geofence: payload };
}

async function checkGeofence(tenantId, latitude, longitude) {
  const geofence = await getTenantGeofence(tenantId);

  if (!geofence) {
    return { allowed: true, reason: "no_geofence" };
  }

  const distance = haversineKm(latitude, longitude, geofence.latitude, geofence.longitude);
  const allowed = distance <= geofence.radiusKm;

  if (!allowed) {
    logger.warn("Geofence check failed", { tenantId, latitude, longitude, distance, radiusKm: geofence.radiusKm });
  }

  return { allowed, distanceKm: distance, radiusKm: geofence.radiusKm };
}

async function evaluateLoginSecurity(tenantId, ip, latitude, longitude) {
  const ipCheck = await checkIpAllowlist(tenantId, ip);
  const geoCheck = await checkGeofence(tenantId, latitude, longitude);

  const allowed = ipCheck.allowed && geoCheck.allowed;

  return {
    allowed,
    ip: ipCheck,
    geofence: geoCheck,
    requiresStepUp: !allowed,
  };
}

exports.getTenantIpAllowlist = getTenantIpAllowlist;
exports.setTenantIpAllowlist = setTenantIpAllowlist;
exports.checkIpAllowlist = checkIpAllowlist;
exports.getTenantGeofence = getTenantGeofence;
exports.setTenantGeofence = setTenantGeofence;
exports.checkGeofence = checkGeofence;
exports.evaluateLoginSecurity = evaluateLoginSecurity;
exports.DEFAULT_GEOFENCE_RADIUS_KM = DEFAULT_GEOFENCE_RADIUS_KM;
