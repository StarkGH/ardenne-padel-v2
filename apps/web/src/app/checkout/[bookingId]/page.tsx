"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { Button, Card, ErrorBanner, InfoBanner, PriceTag, Spinner, TextInput } from "@/components/ui";
import type { Booking, BookingParticipant, CheckoutResult, GuaranteeType, SplitCheckoutResult, SplitPreview, WalletBalance } from "@/lib/types";

// CDC §54 écrans 8-11 — mode de paiement, moyen de paiement, paiement, confirmation.
export default function CheckoutPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = use(params);
  const router = useRouter();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Booking>(`/bookings/${bookingId}`)
      .then(setBooking)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Réservation introuvable."))
      .finally(() => setLoading(false));
  }, [bookingId]);

  if (loading) return <Spinner />;
  if (!booking) return <ErrorBanner message={error ?? "Réservation introuvable."} />;

  if (booking.status !== "CHECKOUT_PENDING") {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Cette réservation n&apos;est plus en attente de paiement.</p>
        <Button onClick={() => router.push(`/bookings/${bookingId}`)}>Voir la réservation</Button>
      </Card>
    );
  }

  return booking.paymentMode === "SPLIT" ? <SplitCheckout booking={booking} /> : <FullCheckout booking={booking} />;
}

// CDC §54 écran 9, Annexe B "paiement mixte wallet + externe" — le wallet
// s'applique d'abord, la carte ne couvre que le solde restant (CDC §28.7).
function FullCheckout({ booking }: { booking: Booking }) {
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [useWallet, setUseWallet] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    api
      .get<WalletBalance>("/me/wallet")
      .then(setWallet)
      .catch(() => setWallet(null));
  }, []);

  const walletAppliedCents = useWallet && wallet ? Math.min(wallet.availableCents, booking.priceTotalCents) : 0;
  const remainingCents = booking.priceTotalCents - walletAppliedCents;

  async function handlePay() {
    setPaying(true);
    setError(null);
    setUnconfigured(false);
    try {
      // CDC §21.1 : pas d'intégration Stripe Elements réelle sans compte
      // Stripe (ADR-0010) — `paymentMethodId` est un identifiant de test, le
      // reste du parcours est câblé contre l'API réelle. Envoyé même à 0 €
      // restant : le backend l'ignore si le wallet couvre déjà tout (§28.8).
      const result = await api.post<CheckoutResult>("/payments/checkout", {
        bookingId: booking.id,
        paymentMethodId: "pm_card_visa",
        applyWalletCents: walletAppliedCents > 0 ? walletAppliedCents : undefined,
      });
      if (result.bookingStatus === "CONFIRMED") {
        router.push(`/bookings/${booking.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "STRIPE_NOT_CONFIGURED") {
        setUnconfigured(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Le paiement n'a pas pu être traité.");
      }
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Paiement</h1>
      <Card className="flex flex-col gap-2">
        <p className="text-sm capitalize text-slate-600">{formatDateTime(booking.startAt)}</p>
        <p className="text-2xl font-bold">
          <PriceTag cents={booking.priceTotalCents} currency={booking.currency} />
        </p>
      </Card>

      {wallet && wallet.availableCents > 0 && (
        <Card className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Utiliser mon solde wallet</p>
            <p className="text-xs text-slate-500">
              Disponible : <PriceTag cents={wallet.availableCents} currency={wallet.currency} />
            </p>
          </div>
          <input
            type="checkbox"
            checked={useWallet}
            onChange={(e) => setUseWallet(e.target.checked)}
            className="h-6 w-6 accent-emerald-600"
          />
        </Card>
      )}

      {remainingCents > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Moyen de paiement</h2>
          <Card className="flex items-center gap-3">
            <input type="radio" checked readOnly className="h-5 w-5 accent-emerald-600" />
            <span className="text-base font-medium">Carte bancaire</span>
          </Card>
        </section>
      )}

      {walletAppliedCents > 0 && (
        <p className="text-sm text-slate-600">
          <PriceTag cents={walletAppliedCents} currency={booking.currency} /> prélevés sur votre wallet
          {remainingCents > 0 && (
            <>
              {" "}
              — <PriceTag cents={remainingCents} currency={booking.currency} /> par carte
            </>
          )}
          .
        </p>
      )}

      {unconfigured && (
        <InfoBanner message="Le paiement en ligne n'est pas encore configuré pour ce club (aucun compte Stripe actif pour l'instant). Cette page reste fonctionnelle et se connectera automatiquement dès qu'une clé Stripe sera configurée." />
      )}
      <ErrorBanner message={error} />

      <Button onClick={handlePay} disabled={paying}>
        {paying ? "Traitement..." : <>Payer <PriceTag cents={booking.priceTotalCents} currency={booking.currency} /></>}
      </Button>
    </div>
  );
}

// CDC §21-§26, §54 écrans 21-23 — garantie du split, consentement au débit futur, frais avant validation.
function SplitCheckout({ booking }: { booking: Booking }) {
  const router = useRouter();
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [guaranteeType, setGuaranteeType] = useState<GuaranteeType>("WALLET_RESERVE");
  const [consent, setConsent] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  const [participants, setParticipants] = useState<BookingParticipant[]>(booking.participants ?? []);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [savingParticipant, setSavingParticipant] = useState(false);
  const [participantError, setParticipantError] = useState<string | null>(null);

  const activeParticipants = participants.filter((p) => p.status !== "REMOVED");
  const maxParticipants = (booking.court?.capacity ?? 4) - 1;
  const canAddParticipant = activeParticipants.length < maxParticipants;

  function reloadPreview() {
    setLoadingPreview(true);
    api
      .get<SplitPreview>(`/bookings/${booking.id}/split-preview`)
      .then(setPreview)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de calculer les parts."))
      .finally(() => setLoadingPreview(false));
  }

  useEffect(reloadPreview, [booking.id]);

  // CDC §54 écran 6 — gestion des participants après création de la
  // réservation (tant qu'elle reste CHECKOUT_PENDING) : le brouillon de
  // /book ne couvre que l'ajout avant paiement, jamais la correction d'une
  // réservation déjà créée (ADR-0020 §3). Recharge aussi l'aperçu de
  // répartition, dont le calcul dépend directement du nombre de participants.
  async function reloadParticipants() {
    try {
      const fresh = await api.get<Booking>(`/bookings/${booking.id}`);
      setParticipants(fresh.participants ?? []);
    } catch {
      // best-effort — la liste locale reste affichée telle quelle si le rechargement échoue.
    }
    reloadPreview();
  }

  async function handleAddParticipant() {
    if (!newName.trim() || !newEmail.trim()) return;
    setSavingParticipant(true);
    setParticipantError(null);
    try {
      await api.post(`/bookings/${booking.id}/participants`, { displayName: newName, invitedEmail: newEmail });
      setNewName("");
      setNewEmail("");
      await reloadParticipants();
    } catch (err) {
      setParticipantError(err instanceof ApiError ? err.message : "Impossible d'ajouter ce participant.");
    } finally {
      setSavingParticipant(false);
    }
  }

  async function handleRemoveParticipant(participantId: string) {
    setParticipantError(null);
    try {
      await api.delete(`/bookings/${booking.id}/participants/${participantId}`);
      await reloadParticipants();
    } catch (err) {
      setParticipantError(err instanceof ApiError ? err.message : "Impossible de retirer ce participant.");
    }
  }

  const requiresConsent = guaranteeType === "CARD_OFF_SESSION";
  const canPay = !requiresConsent || consent;

  async function handlePay() {
    setPaying(true);
    setError(null);
    setUnconfigured(false);
    try {
      const result = await api.post<SplitCheckoutResult>("/payments/checkout", {
        bookingId: booking.id,
        paymentMethodId: "pm_card_visa",
        guaranteeType,
      });
      if (result.bookingStatus === "CONFIRMED") {
        router.push(`/bookings/${booking.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "STRIPE_NOT_CONFIGURED") {
        setUnconfigured(true);
      } else if (err instanceof ApiError && err.code === "3DS_REQUIRED_UNSUPPORTED_FOR_SPLIT") {
        setError("Ce moyen de paiement nécessite une vérification supplémentaire non prise en charge pour le paiement partagé. Essayez un autre moyen de paiement.");
      } else {
        setError(err instanceof ApiError ? err.message : "Le paiement n'a pas pu être traité.");
      }
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Paiement partagé</h1>
      <Card className="flex flex-col gap-2">
        <p className="text-sm capitalize text-slate-600">{formatDateTime(booking.startAt)}</p>
        <p className="text-2xl font-bold">
          <PriceTag cents={booking.priceTotalCents} currency={booking.currency} />
        </p>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">
          Participants <span className="font-normal text-slate-400">({activeParticipants.length}/{maxParticipants})</span>
        </h2>
        <div className="flex flex-col gap-3">
          {activeParticipants.map((p) => (
            <Card key={p.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{p.displayName}</p>
                <p className="text-xs text-slate-500">{p.invitedEmail}</p>
              </div>
              <button onClick={() => handleRemoveParticipant(p.id)} className="text-xs text-red-600">
                Retirer
              </button>
            </Card>
          ))}
          {activeParticipants.length === 0 && <p className="text-xs text-slate-500">Aucun participant pour l&apos;instant.</p>}
          {canAddParticipant && (
            <Card className="flex flex-col gap-2">
              <TextInput placeholder="Nom" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <TextInput placeholder="E-mail" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              <Button
                variant="secondary"
                onClick={handleAddParticipant}
                disabled={savingParticipant || !newName.trim() || !newEmail.trim()}
              >
                {savingParticipant ? "..." : "+ Ajouter un participant"}
              </Button>
            </Card>
          )}
          <ErrorBanner message={participantError} />
        </div>
      </section>

      {loadingPreview && <Spinner />}

      {preview && (
        <>
          {/* Écran 23 — frais de service visible avant validation (CDC §24.5). */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-500">Répartition ({preview.shareCount} participants)</h2>
            <Card className="flex flex-col gap-2">
              {preview.shares.map((share, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">
                    {share.isOrganizer ? "Vous (à régler maintenant)" : `Participant ${i + 1}`}
                    {share.serviceFeeAmountCents > 0 && (
                      <span className="ml-1 text-xs text-slate-400">(dont <PriceTag cents={share.serviceFeeAmountCents} currency={preview.currency} /> de frais)</span>
                    )}
                  </span>
                  <span className="font-medium">
                    <PriceTag cents={share.totalAmountCents} currency={preview.currency} />
                  </span>
                </div>
              ))}
            </Card>
          </section>

          {/* Écran 21 — garantie de l'organisateur (CDC §25). */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-500">Garantie des parts non payées</h2>
            <p className="mb-3 text-xs text-slate-500">
              Vous garantissez le paiement des autres participants (<PriceTag cents={preview.guaranteedCents} currency={preview.currency} /> au total). Si un
              participant ne règle pas sa part avant l&apos;échéance, elle vous sera prélevée.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setGuaranteeType("WALLET_RESERVE")}
                className={`min-h-11 rounded-xl border-2 px-4 py-3 text-left text-sm font-medium ${
                  guaranteeType === "WALLET_RESERVE" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
                }`}
              >
                Réserver sur mon solde wallet
              </button>
              <button
                onClick={() => setGuaranteeType("CARD_OFF_SESSION")}
                className={`min-h-11 rounded-xl border-2 px-4 py-3 text-left text-sm font-medium ${
                  guaranteeType === "CARD_OFF_SESSION" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white"
                }`}
              >
                Autoriser ma carte bancaire
              </button>
            </div>
          </section>

          {/* Écran 22 — consentement explicite au débit futur si carte. */}
          {requiresConsent && (
            <Card className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 h-5 w-5 accent-emerald-600"
                id="consent"
              />
              <label htmlFor="consent" className="text-sm text-slate-700">
                J&apos;autorise Ardenne Padel à débiter ma carte bancaire pour couvrir les parts non payées par les autres participants avant
                l&apos;échéance de la réservation.
              </label>
            </Card>
          )}

          {unconfigured && (
            <InfoBanner message="Le paiement en ligne n'est pas encore configuré pour ce club (aucun compte Stripe actif pour l'instant). Cette page reste fonctionnelle et se connectera automatiquement dès qu'une clé Stripe sera configurée." />
          )}
          <ErrorBanner message={error} />

          <Button onClick={handlePay} disabled={paying || !canPay}>
            {paying ? "Traitement..." : <>Payer ma part et inviter <PriceTag cents={preview.organizerShareCents} currency={preview.currency} /></>}
          </Button>
        </>
      )}
    </div>
  );
}
