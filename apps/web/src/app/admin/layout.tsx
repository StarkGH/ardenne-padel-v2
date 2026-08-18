"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { ErrorBanner, Spinner } from "@/components/ui";
import type { Role } from "@/lib/types";

const ADMIN_ROLES: Role[] = ["STAFF", "ADMIN", "SUPER_ADMIN"];

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: "/admin/dashboard", label: "Tableau de bord" },
  { href: "/admin/planning", label: "Planning" },
  { href: "/admin/bookings/new", label: "Nouvelle réservation" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/legacy-clients", label: "Migration Doinsport" },
  { href: "/admin/tariffs", label: "Tarifs" },
  { href: "/admin/schedule", label: "Horaires" },
  { href: "/admin/wallets", label: "Wallets" },
  { href: "/admin/credit-packs", label: "Packs de crédits" },
  { href: "/admin/credit-pack-purchases", label: "Achats de crédits" },
  { href: "/admin/payments", label: "Paiements" },
  { href: "/admin/reports", label: "Chiffre d'affaires" },
  { href: "/admin/kiosks", label: "Kiosques" },
  { href: "/admin/terminals", label: "Terminaux" },
  { href: "/admin/sync", label: "Synchro Legacy" },
  { href: "/admin/access", label: "Accès" },
  { href: "/admin/incidents", label: "Incidents" },
  { href: "/admin/audit-log", label: "Audit log" },
  { href: "/admin/settings", label: "Paramètres" },
];

/**
 * CDC §55 — espace équipe. Même authentification que le parcours client
 * (`POST /auth/login`, cookie de session) : aucun compte "admin-only"
 * distinct côté backend, seul le rôle change (CDC §58 : STAFF lit, ADMIN
 * modifie, SUPER_ADMIN change les rôles). Cette page se contente donc de
 * refuser le rendu pour un rôle CUSTOMER plutôt que de dépendre d'un
 * mécanisme d'auth séparé qui n'existe pas côté backend.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname === "/admin/login";

  useEffect(() => {
    if (loading || isLoginPage) return;
    if (!user) router.push(`/admin/login?next=${encodeURIComponent(pathname)}`);
  }, [user, loading, isLoginPage, pathname, router]);

  if (isLoginPage) return <>{children}</>;
  if (loading || !user) return <Spinner />;

  if (!ADMIN_ROLES.includes(user.role)) {
    return <ErrorBanner message="Accès réservé au personnel du club." />;
  }

  return (
    // Évade le `max-w-lg mx-auto` du layout racine (pensé pour les écrans
    // client mobile-first, CDC §53) : l'admin a besoin de toute la largeur
    // disponible sur desktop (tableaux, grille planning) tout en restant
    // sans effet sur mobile (le viewport est déjà plus étroit que max-w-lg).
    <div className="relative left-1/2 right-1/2 -mx-[50vw] flex w-screen max-w-none flex-col gap-4 px-4 md:px-8">
      <nav className="flex flex-col gap-2 border-b border-slate-200 pb-3">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            {user.email} · {user.role}
          </span>
          <button
            onClick={() => {
              void logout().then(() => router.push("/admin/login"));
            }}
            className="text-slate-500 hover:text-red-600"
          >
            Déconnexion
          </button>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`font-medium hover:text-emerald-800 ${pathname.startsWith(link.href) ? "text-emerald-800 underline" : "text-emerald-700"}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
