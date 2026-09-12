/**
 * Port (CDC §34.2 marges avant/après un créneau) — permet de surcharger,
 * terrain par terrain, les marges globales `ACCESS_ENABLED_BEFORE/AFTER_MINUTES`
 * sans coupler ce module à `automation` (qui possède le concept de zone où
 * ces réglages sont réellement édités, `/admin/automation`). L'implémentation
 * réelle (`ZoneAccessMarginsAdapter`) vit dans `automation` ; ce module ne
 * connaît que cette interface, injectée par `app.ts`.
 */
export interface AccessMarginsProvider {
  getMarginsForCourt(courtId: string): Promise<{ beforeMinutes: number; afterMinutes: number }>;
}
