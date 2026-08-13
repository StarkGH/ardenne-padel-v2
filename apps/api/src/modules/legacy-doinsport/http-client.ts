import type { AppConfig } from "@ardenne/config";
import type { LegacyDoinsportRepository } from "./legacy-doinsport.repository.js";
import { resolveUserClubId } from "./userclub-resolver.js";
import { LegacyApiError } from "./legacy-errors.js";

export interface LegacyAuthResult {
  token: string;
  userClubId: string;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  _retry?: boolean;
}

/**
 * Port du client HTTP audité (`padel-service/doinsport.js`) : mêmes règles
 * (refresh sur 401 avec un seul retry, token jamais loggé), simplement porté
 * de SQLite vers PostgreSQL/Prisma pour le stockage du token.
 */
export class DoinsportHttpClient {
  constructor(
    private readonly config: AppConfig,
    private readonly repo: LegacyDoinsportRepository,
  ) {}

  get clubId(): string {
    if (!this.config.DOINSPORT_CLUB_ID) throw new Error("DOINSPORT_CLUB_ID manquant dans la configuration");
    return this.config.DOINSPORT_CLUB_ID;
  }

  async authenticateClub(): Promise<LegacyAuthResult> {
    const login = this.config.DOINSPORT_CLUB_LOGIN;
    const password = this.config.DOINSPORT_CLUB_PASSWORD;
    if (!login || !password) {
      throw new Error("DOINSPORT_CLUB_LOGIN / DOINSPORT_CLUB_PASSWORD manquants dans la configuration");
    }

    const res = await this.rawFetch(new URL("/club_login_check", this.config.DOINSPORT_BASE_URL).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: login, password }),
    });

    const text = await res.text();
    if (!res.ok) throw new LegacyApiError(res.status, text);

    const data = text ? (JSON.parse(text) as { token?: string }) : null;
    if (!data?.token) throw new Error("authenticateClub: réponse Doinsport sans token");

    await this.repo.storeToken(data.token);
    const userClubId = resolveUserClubId(data.token, this.config.DOINSPORT_USERCLUB_ID);
    return { token: data.token, userClubId };
  }

  private buildUrl(path: string, params: Record<string, unknown> = {}): string {
    const url = new URL(path, this.config.DOINSPORT_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async rawFetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err) {
      throw new LegacyApiError("timeout", err instanceof Error ? err.message : String(err));
    }
  }

  async call<T>(path: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
    let token = await this.repo.getLatestToken();
    if (!token) {
      token = (await this.authenticateClub()).token;
    }

    const res = await this.rawFetch(this.buildUrl(path, params), {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await res.text();

    if (!res.ok) {
      if (res.status === 401 && !options._retry) {
        await this.authenticateClub();
        return this.call<T>(path, params, { ...options, _retry: true });
      }
      throw new LegacyApiError(res.status, text);
    }

    return (text ? JSON.parse(text) : null) as T;
  }
}
