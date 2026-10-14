import type { Role } from "@prisma/client";

// The app has a flat role model (AGENT, DEVELOPER, CUSTOMER, ADMIN) and no per-user
// permission table, so permissions are granted by role. They are still checked individually
// everywhere, so splitting them across future admin sub-roles only means editing this map.
export type Permission =
  | "email.view"
  | "email.manage" // create, duplicate, delete, activate/deactivate
  | "email.edit" // save drafts
  | "email.publish"
  | "email.restore"
  | "email.test"
  | "email.source" // edit raw HTML source
  | "email.layout"; // edit the shared layout used by every email

const ADMIN_PERMISSIONS: Permission[] = [
  "email.view",
  "email.manage",
  "email.edit",
  "email.publish",
  "email.restore",
  "email.test",
  "email.source",
  "email.layout",
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ADMIN_PERMISSIONS,
  AGENT: [],
  DEVELOPER: [],
  CUSTOMER: [],
};

export interface Actor {
  id: number;
  role: Role;
  email?: string;
}

export function hasPermission(actor: Pick<Actor, "role">, permission: Permission) {
  return ROLE_PERMISSIONS[actor.role]?.includes(permission) ?? false;
}

export function permissionsFor(actor: Pick<Actor, "role">): Permission[] {
  return ROLE_PERMISSIONS[actor.role] ?? [];
}
