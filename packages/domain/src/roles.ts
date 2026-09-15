/**
 * Rôles minimaux (CDC §8) + `COACH` (Academy — rôle dédié, distinct de
 * `STAFF` : un coach n'a pas les accès back-office club, uniquement les
 * fonctions Academy qui le concernent). Positionné entre `CUSTOMER` et
 * `STAFF` dans la hiérarchie : le staff/admin garde accès aux fonctions
 * Academy protégées par `requireRole("COACH")`, mais un coach n'obtient pas
 * les droits `STAFF`.
 */
export const Roles = ["CUSTOMER", "COACH", "STAFF", "ADMIN", "SUPER_ADMIN"] as const;
export type Role = (typeof Roles)[number];

const ROLE_RANK: Record<Role, number> = {
  CUSTOMER: 0,
  COACH: 1,
  STAFF: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

/** true si `role` a au moins les privilèges de `required` (hiérarchie simple, pas de permissions à la carte au Lot 1). */
export function roleAtLeast(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
