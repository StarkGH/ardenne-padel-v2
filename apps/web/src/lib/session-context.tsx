"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { AuthUser } from "./types";

interface SessionContextValue {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * État d'authentification côté client. Volontairement pas de rendu serveur
 * de l'utilisateur connecté dans ce premier lot frontend (aurait demandé de
 * relayer le cookie de session dans chaque Server Component) — chaque page
 * qui a besoin de savoir si un utilisateur est connecté le découvre via ce
 * contexte, après un aller-retour `GET /auth/me`. Documenté comme piste
 * d'amélioration dans l'ADR plutôt que traité comme un défaut caché.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<AuthUser>("/auth/me");
      setUser(me);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setUser(null);
  }, []);

  /** CDC §54 écran 18 — déconnexion de toutes les sessions actives. */
  const logoutAll = useCallback(async () => {
    await api.post("/auth/logout-all");
    setUser(null);
  }, []);

  return <SessionContext.Provider value={{ user, loading, refresh, logout, logoutAll }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
