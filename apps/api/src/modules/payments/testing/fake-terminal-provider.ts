import { randomUUID } from "node:crypto";
import type {
  CreateTerminalPaymentIntentInput,
  TerminalConnectionToken,
  TerminalPaymentIntentRef,
  TerminalProvider,
} from "../terminal-provider.js";

export class FakeTerminalProvider implements TerminalProvider {
  createResult: TerminalPaymentIntentRef["status"] = "requires_capture";
  captureShouldFail = false;
  cancelCalls: string[] = [];

  async createConnectionToken(_locationId?: string): Promise<TerminalConnectionToken> {
    return { secret: `pst_test_${randomUUID()}` };
  }

  async createPaymentIntent(_input: CreateTerminalPaymentIntentInput): Promise<TerminalPaymentIntentRef> {
    return { providerPaymentId: `pi_terminal_${randomUUID()}`, status: this.createResult };
  }

  async capturePaymentIntent(providerPaymentId: string): Promise<TerminalPaymentIntentRef> {
    return { providerPaymentId, status: this.captureShouldFail ? "failed" : "succeeded" };
  }

  async cancelPaymentIntent(providerPaymentId: string): Promise<TerminalPaymentIntentRef> {
    this.cancelCalls.push(providerPaymentId);
    return { providerPaymentId, status: "canceled" };
  }
}
