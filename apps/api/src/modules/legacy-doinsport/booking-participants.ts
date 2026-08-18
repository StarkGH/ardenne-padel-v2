/**
 * CDC §55 écran 3 — extraction des participants et du statut de paiement
 * d'une réservation Doinsport, à partir de `LegacyBookingDto.raw` (jamais
 * exposé ailleurs — CDC §12.1, seul `legacy-doinsport.adapter.ts` connaît la
 * forme brute Doinsport, ce module ne fait que la lire une fois extraite).
 *
 * Statut de paiement calculé au niveau de la réservation entière, jamais par
 * participant : `raw.payments[].participantId` ne correspond à aucun
 * identifiant exposé dans `raw.participants[]` (ni `client.id`, ni
 * `user.id`) — vérifié empiriquement sur plusieurs réservations réelles à
 * 2+ participants. Une association par participant serait une supposition
 * non documentée, avec un risque réel de désigner la mauvaise personne
 * comme n'ayant pas payé — pire que pas d'information du tout.
 */

export interface ExtractedParticipant {
  firstName: string;
  lastName: string;
  legacyClientId: string | null;
  canceled: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function extractParticipants(raw: unknown): ExtractedParticipant[] {
  const participants = asArray(asRecord(raw).participants);
  return participants.map((p) => {
    const participant = asRecord(p);
    const client = asRecord(participant.client);
    return {
      firstName: typeof client.firstName === "string" ? client.firstName : "",
      lastName: typeof client.lastName === "string" ? client.lastName : "",
      legacyClientId: typeof client.id === "string" ? client.id : null,
      canceled: Boolean(participant.canceled),
    };
  });
}

/** Total dû (participants non annulés) <= total encaissé (paiements réussis). */
export function computeFullyPaid(raw: unknown): boolean {
  const record = asRecord(raw);
  const participants = asArray(record.participants);
  const dueCents = participants.reduce<number>((sum, p) => {
    const participant = asRecord(p);
    if (Boolean(participant.canceled)) return sum;
    return sum + asNumber(participant.price);
  }, 0);
  if (dueCents === 0) return true;

  const payments = asArray(record.payments);
  const receivedCents = payments.reduce<number>((sum, p) => {
    const payment = asRecord(asRecord(p).payment);
    if (payment.status !== "succeeded") return sum;
    return sum + asNumber(payment.amountReceived);
  }, 0);

  return receivedCents >= dueCents;
}
