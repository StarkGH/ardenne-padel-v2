/**
 * Tous les montants du domaine sont des entiers en centimes (CDC §80).
 * Ne jamais utiliser de float pour un calcul financier.
 */
export type Cents = number;

export function isValidCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export function assertCents(value: unknown, label: string): asserts value is Cents {
  if (!isValidCents(value)) {
    throw new Error(`${label} doit être un entier de centimes, reçu: ${String(value)}`);
  }
}

export function addCents(...values: Cents[]): Cents {
  return values.reduce((sum, v) => {
    assertCents(v, "addCents operand");
    return sum + v;
  }, 0);
}

export function subtractCents(a: Cents, b: Cents): Cents {
  assertCents(a, "subtractCents a");
  assertCents(b, "subtractCents b");
  return a - b;
}

/**
 * Répartit un montant total en `parts` parts égales, en centimes entiers,
 * en distribuant les centimes résiduels aux premières parts (CDC §23.3).
 * Exemple : splitEvenly(1000, 3) -> [334, 333, 333]
 */
export function splitEvenly(totalCents: Cents, parts: number): Cents[] {
  assertCents(totalCents, "splitEvenly totalCents");
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new Error(`splitEvenly: parts doit être un entier positif, reçu: ${parts}`);
  }
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  return Array.from({ length: parts }, (_, i) => (i < remainder ? base + 1 : base));
}

export function centsToDisplayString(cents: Cents, currency = "EUR"): string {
  assertCents(cents, "centsToDisplayString cents");
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency }).format(cents / 100);
}
