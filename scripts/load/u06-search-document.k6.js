// U-06 (ADR-119): the two hot paths the P8-07 baseline (p807-baseline.k6.js) does not call —
// global search and the certificate document. Same stack, same seed, run the same way:
//   docker run --rm --network <net> -v $PWD/scripts/load/u06-search-document.k6.js:/load.js:ro \
//     -e VUS=10 -e DURATION=60s -e BASES=http://backend:3000/api/v1 grafana/k6 run /load.js
// after scripts/load/p807-seed.sql. EP=<search|document> restricts the mix.
//
// search:   GET /search?q=…&limit=10 as the two load tenants' admins. Every device result must carry
//           the caller's serial prefix (DEMOA- / DEMOB-, set by the seed): a foreign row is a leak.
// document: GET /certificates/:id/document as the demo HEALTHCARE ADMIN of the default tenant, for
//           each certificate the demo seed gave that tenant (the load tenants have none).
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE = (__ENV.BASES || "http://backend:3000/api/v1").split(",")[0];
const VUS = Number(__ENV.VUS || 10);
const leaks = new Counter("tenant_leaks");
const s5xx = new Counter("status_5xx");

export const options = {
  scenarios: { mixed: { executor: "constant-vus", vus: VUS, duration: __ENV.DURATION || "60s" } },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    "http_req_duration{ep:search}": ["p(95)<500"],
    "http_req_duration{ep:document}": ["p(95)<5000"],
    tenant_leaks: ["count==0"],
  },
};

const login = (user) => {
  const r = http.post(`${BASE}/auth/login`, JSON.stringify({ user, password: "Demo123!" }), {
    headers: { "Content-Type": "application/json" },
  });
  return r.json().token;
};

export function setup() {
  const out = {
    "demo-alpha": { token: login("load@demo-alpha.test"), prefix: "DEMOA-" },
    "demo-beta": { token: login("load@demo-beta.test"), prefix: "DEMOB-" },
    docs: { token: login("demo.healtcare_admin@demo.callibrator.test"), ids: [] },
  };
  const list = http.get(`${BASE}/certificates?limit=50`, { headers: { Authorization: `Bearer ${out.docs.token}` } });
  out.docs.ids = (list.json().data || []).map((c) => c.id);
  return out;
}

const QUERIES = ["Maker", "infusion", "ventilator", "monitor", "DEMO", "Device 00012", "M1", "scale"];

export default function (ctx) {
  const pool = __ENV.EP ? [__ENV.EP] : ["search", "document"];
  const ep = pool[Math.floor(Math.random() * pool.length)];
  if (ep === "search") {
    const sub = (__VU + __ITER) % 2 === 0 ? "demo-alpha" : "demo-beta";
    const me = ctx[sub];
    const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
    const r = http.get(`${BASE}/search?q=${encodeURIComponent(q)}&limit=10`, {
      headers: { Authorization: `Bearer ${me.token}` },
      tags: { ep },
    });
    if (r.status >= 500) s5xx.add(1);
    if (!check(r, { "search 200": (x) => x.status === 200 })) return;
    const devices = (r.json().data.byType || {}).device || [];
    if (devices.some((d) => !String(d.serialNumber).startsWith(me.prefix))) leaks.add(1, { ep });
    return;
  }
  const ids = ctx.docs.ids;
  if (ids.length === 0) return;
  const id = ids[Math.floor(Math.random() * ids.length)];
  const r = http.get(`${BASE}/certificates/${id}/document`, {
    headers: { Authorization: `Bearer ${ctx.docs.token}` },
    tags: { ep },
  });
  if (r.status >= 500) s5xx.add(1);
  check(r, { "document 200": (x) => x.status === 200 });
}
