import type { MenuItem } from "@/types";

export type ExtendedMenuItem = MenuItem & { isAssigned?: boolean };

export interface ExtendedMenuGroup {
  id?: string;
  label?: string;
  path?: string;
  isAssigned?: boolean;
  items?: ExtendedMenuItem[];
}
