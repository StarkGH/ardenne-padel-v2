/** Rôles minimaux (CDC §8). */
export const Roles = ["CUSTOMER", "STAFF", "ADMIN", "SUPER_ADMIN"] as const;
export type Role = (typeof Roles)[number];

const ROLE_RANK: Record<Role, number> = {
  CUSTOMER: 0,
  STAFF: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

/** true si `role` a au moins les privilèges de `required` (hiérarchie simple, pas de permissions à la carte au Lot 1). */
export function roleAtLeast(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
