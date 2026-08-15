const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * Client HTTP minimal — jamais de logique métier ici (CDC §129 : "le
 * frontend ne doit pas contenir de logique métier critique"), uniquement la
 * traduction requête/réponse. `credentials: "include"` envoie le cookie de
 * session sur chaque appel : web (port 3001) et api (port 3000) partagent le
 * même domaine "localhost" donc le même site, seul le port diffère — le
 * cookie `SameSite=Lax` posé par l'API est donc envoyé normalement, à
 * condition que l'API autorise l'origine via CORS (`CORS_ALLOWED_ORIGINS`,
 * Lot 10).
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
