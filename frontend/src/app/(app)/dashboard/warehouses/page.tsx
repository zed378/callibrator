// src/app/dashboard/warehouses/page.tsx
// The sidebar menu links to /dashboard/warehouses (see backend
// menuGroup.service mapSlugToPath). The implementation lives in
// ../warehouse — re-export it so both routes serve the same page.
export { default } from "../warehouse/page";
