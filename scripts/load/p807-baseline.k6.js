// P8-07 (ADR-086) baseline load test. Run from a container on the stack's network, e.g.
//   docker run --rm --network <net> -v $PWD/scripts/load/p807-baseline.k6.js:/load.js:ro //     -e VUS=50 -e DURATION=60s -e BASES=http://backend:3000/api/v1 grafana/k6 run /load.js
// after seeding with scripts/load/p807-seed.sql (needs the demo seed first: GET /migration/seeding,
// then /migration/seed-demo). EP=<devices|devices_find|records|audit|dashboard> restricts the mix.
//
// P8-07 baseline — two tenants hammered concurrently; every response is checked for
// the caller's tenant (AsyncLocalStorage bleed would show as a foreign row or a wrong total).
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASES = (__ENV.BASES || "http://callib-p8-backend-1:3000/api/v1").split(",");
const BASE = BASES[0];
const VUS = Number(__ENV.VUS || 50);
const leaks = new Counter("tenant_leaks");
const s408 = new Counter("status_408");
const s429 = new Counter("status_429");
const s5xx = new Counter("status_5xx");

export const options = {
  scenarios: { mixed: { executor: "constant-vus", vus: VUS, duration: __ENV.DURATION || "2m" } },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    "http_req_duration{ep:devices}": ["p(95)<500"],
    "http_req_duration{ep:devices_find}": ["p(95)<500"],
    "http_req_duration{ep:records}": ["p(95)<500"],
    "http_req_duration{ep:audit}": ["p(95)<500"],
    "http_req_duration{ep:dashboard}": ["p(95)<2000"],
    tenant_leaks: ["count==0"],
    status_408: ["count==0"],
    status_429: ["count==0"],
  },
};

export function setup() {
  const out = {};
  for (const sub of ["demo-alpha", "demo-beta"]) {
    const r = http.post(`${BASE}/auth/login`, JSON.stringify({ user: `load@${sub}.test`, password: "Demo123!" }),
      { headers: { "Content-Type": "application/json" } });
    const b = r.json();
    out[sub] = { token: b.token, tenantId: b.data.tenantId || b.data.tenant_id || (b.data.tenant && b.data.tenant.id) };
  }
  return out;
}

function rows(body) {
  const d = body && body.data;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.rows)) return d.rows;
  return [];
}
function total(body) {
  if (body && body.meta && body.meta.total !== undefined) return body.meta.total;
  if (body && body.data && body.data.meta) return body.data.meta.total;
  if (body && body.data && body.data.count !== undefined) return body.data.count;
  return undefined;
}

function tally(r) {
  if (r.status === 408) s408.add(1);
  if (r.status === 429) s429.add(1);
  if (r.status >= 500) s5xx.add(1);
}

export default function (ctx) {
  const sub = (__VU + __ITER) % 2 === 0 ? "demo-alpha" : "demo-beta";
  const me = ctx[sub];
  const h = { headers: { Authorization: `Bearer ${me.token}` } };
  const B = BASES[(__VU + __ITER) % BASES.length];
  const page = 1 + Math.floor(Math.random() * 400);
  const reqs = [
    ["devices", `${B}/calibration-devices?page=${page}&limit=10`, 5000],
    ["devices_find", `${B}/calibration-devices?find=Device%200${1 + (page % 4)}&limit=10`, null],
    ["records", `${B}/calibration-records?page=${page}&limit=10`, 50000],
    ["audit", `${B}/audit?page=${page}&limit=10`, null],
    ["dashboard", `${B}/dashboard/metrics`, null],
  ];
  const pool = __ENV.EP ? reqs.filter((x) => x[0] === __ENV.EP) : reqs;
  const [ep, url, expectTotal] = pool[Math.floor(Math.random() * pool.length)];
  const r = http.get(url, Object.assign({ tags: { ep } }, h));
  tally(r);
  const ok = check(r, { [`${ep} 200`]: (x) => x.status === 200 });
  if (!ok) return;
  const body = r.json();
  const foreign = rows(body).filter((x) => (x.tenantId || x.tenant_id) && (x.tenantId || x.tenant_id) !== me.tenantId);
  let leak = foreign.length > 0;
  if (expectTotal !== null && total(body) !== expectTotal) leak = true;
  if (ep === "dashboard") {
    const d = body.data || {};
    const devs = d.devices ? d.devices.total : d.totalDevices;
    if (devs !== undefined && devs !== 5000) leak = true;
  }
  if (leak) leaks.add(1, { ep });
}
