/**
 * Questions answered from the SERVER-resolved menu tree (stores/menuStore.ts)
 * — never from a client-side permission list (docs/FRONTEND/05-RBAC-IN-UI.md).
 */

/** The part of a menu node these helpers read. */
export interface MenuNode {
  path?: string;
  items?: MenuNode[];
}

/**
 * F-10: the menus whose `read` permission lets a principal search, as the
 * paths the backend gives them in the menu tree.
 *
 * Backend: search.service.js TYPES → menu slugs `calibration` (devices),
 * `warehouse` (stock) and `certificate`; menuGroup.service.js mapSlugToPath
 * maps them to these paths. `GET /search` is gated on read of ANY of the three
 * (A-04), so a tree containing none of them means every search would 403.
 */
export const SEARCHABLE_MENU_PATHS = [
  "/dashboard/devices",
  "/dashboard/warehouses",
  "/dashboard/calibration",
] as const;

/** Whether any node at any depth of `groups` has one of `paths`. */
export const menuHasAnyPath = (
  groups: readonly MenuNode[],
  paths: readonly string[],
): boolean =>
  groups.some(
    (node) =>
      (node.path !== undefined && paths.includes(node.path)) ||
      menuHasAnyPath(node.items ?? [], paths),
  );
