import type { StripeClientPort, StripePaymentIntentLike } from "./stripe-client-port.js";
import type {
  CreateTerminalPaymentIntentInput,
  TerminalConnectionToken,
  TerminalPaymentIntentRef,
  TerminalProvider,
} from "./terminal-provider.js";

function toStatus(status: string): TerminalPaymentIntentRef["status"] {
  switch (status) {
    case "requires_capture":
      return "requires_capture";
    case "succeeded":
      return "succeeded";
    case "canceled":
      return "canceled";
    case "processing":
      return "processing";
    default:
      return "failed";
  }
}

function toRef(pi: StripePaymentIntentLike): TerminalPaymentIntentRef {
  return { providerPaymentId: pi.id, status: toStatus(pi.status), clientSecret: pi.client_secret ?? undefined };
}

export class StripeTerminalProvider implements TerminalProvider {
  constructor(private readonly client: StripeClientPort) {}

  async createConnectionToken(locationId?: string): Promise<TerminalConnectionToken> {
    return this.client.terminal.createConnectionToken(locationId);
  }

  async createPaymentIntent(input: CreateTerminalPaymentIntentInput): Promise<TerminalPaymentIntentRef> {
    // CDC §27.1 : même prudence qu'en ligne — capture manuelle par défaut,
    // pour ne débiter qu'après confirmation Legacy le jour où ce canal sera
    // câblé dans l'orchestration.
    const pi = await this.client.terminal.createPaymentIntent({
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      captureMethod: "manual",
    });
    return toRef(pi);
  }

  async capturePaymentIntent(providerPaymentId: string): Promise<TerminalPaymentIntentRef> {
    return toRef(await this.client.terminal.capturePaymentIntent(providerPaymentId));
  }

  async cancelPaymentIntent(providerPaymentId: string): Promise<TerminalPaymentIntentRef> {
    return toRef(await this.client.terminal.cancelPaymentIntent(providerPaymentId));
  }
}
