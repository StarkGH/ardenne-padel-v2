import { AppError, ErrorCodes } from "@ardenne/shared";
import { generateOpaqueToken, hashToken } from "../identity/tokens.js";
import type { KioskDeviceRepository } from "./kiosk-device.repository.js";

export interface RegisterKioskDeviceInput {
  name: string;
  location?: string;
  capabilities: Array<"TERMINAL" | "QR_HANDOFF">;
}

/**
 * CDC §22.6, §59.2 — dispositifs kiosque enregistrés et révocables. La clé
 * brute n'est jamais stockée ni loggée (CDC §57.1) : seule sa version
 * hashée l'est, la clé brute n'est retournée qu'une fois, à l'enregistrement
 * (même logique que les autres secrets à usage unique de l'application).
 */
export class KioskDeviceService {
  constructor(private readonly repo: KioskDeviceRepository) {}

  async register(input: RegisterKioskDeviceInput): Promise<{ deviceId: string; deviceKey: string }> {
    const { raw, hash } = generateOpaqueToken();
    const device = await this.repo.create({
      name: input.name,
      location: input.location,
      capabilities: input.capabilities,
      deviceKeyHash: hash,
    });
    return { deviceId: device.id, deviceKey: raw };
  }

  async authenticate(rawDeviceKey: string) {
    const device = await this.repo.findByKeyHash(hashToken(rawDeviceKey));
    if (!device || device.status !== "ACTIVE") {
      throw new AppError(ErrorCodes.UNAUTHENTICATED, "Dispositif kiosque inconnu ou révoqué.", 401);
    }
    await this.repo.touchLastSeen(device.id);
    return device;
  }

  async revoke(deviceId: string) {
    await this.repo.revoke(deviceId);
  }

  async listActive() {
    return this.repo.listActive();
  }

  /** CDC §39.3 — un kiosque silencieux au-delà du seuil est considéré hors ligne. */
  isOffline(lastSeenAt: Date | null, thresholdMinutes: number): boolean {
    if (!lastSeenAt) return true;
    return Date.now() - lastSeenAt.getTime() > thresholdMinutes * 60_000;
  }
}
