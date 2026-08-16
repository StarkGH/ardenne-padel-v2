import { ApiError } from "./api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";
const KIOSK_DEVICE_KEY = process.env.NEXT_PUBLIC_KIOSK_DEVICE_KEY ?? "";

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * Client HTTP pour les appels authentifiés par le dispositif kiosque (CDC
 * §22.2, §57.1) — un jeton statique par tablette, envoyé en
 * `Authorization: Bearer`, sans rapport avec le cookie de session client
 * (`api.ts`). Jamais `credentials: "include"` : le kiosque n'est pas un
 * utilisateur et ne doit jamais porter le cookie d'un client de passage.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    // Le statut est interrogé en boucle sur la même URL (écran 6, CDC
    // §54.1) — sans ceci, certains navigateurs servent une réponse GET mise
    // en cache au lieu de repasser par le serveur.
    cache: "no-store",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${KIOSK_DEVICE_KEY}`,
      ...options.headers,
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const body = (await res.json().catch(() => null)) as (ApiErrorBody & { data?: T }) | null;

  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? "Une erreur inattendue est survenue.", err?.details);
  }

  return (body?.data as T) ?? (undefined as T);
}

export const kioskApi = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
};
