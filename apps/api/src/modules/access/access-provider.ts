export interface AccessGrantRef {
  id: string;
  code: string;
  scope: string;
  validFrom: Date;
  validUntil: Date;
}

export interface ProviderRef {
  providerReference: string;
}

export interface AccessHealth {
  healthy: boolean;
  detail?: string;
}

/**
 * CDC §34.5 — abstraction matérielle. Le domaine Booking ne connaît jamais
 * de vendeur de contrôle d'accès spécifique (CDC §34.5 : "Ne pas coupler
 * Booking à un matériel spécifique").
 */
export interface AccessProvider {
  provisionGrant(grant: AccessGrantRef): Promise<ProviderRef>;
  updateGrant(grant: AccessGrantRef): Promise<void>;
  revokeGrant(grant: AccessGrantRef): Promise<void>;
  healthCheck(): Promise<AccessHealth>;
}
