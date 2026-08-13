/** États de compte utilisateur V2. Distincts des états de migration Legacy (CDC §7.4, ajoutés au Lot 2). */
export const UserStatuses = ["PENDING_VERIFICATION", "ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof UserStatuses)[number];
