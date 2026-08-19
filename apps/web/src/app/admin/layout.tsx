"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { ErrorBanner, Spinner } from "@/components/ui";
import type { Role } from "@/lib/types";

const ADMIN_ROLES: Role[] = ["STAFF", "ADMIN", "SUPER_ADMIN"];

const NAV_GROUPS: Array<{ label: string; links: Array<{ href: string; label: string }> }> = [
  {
    label: "Vue d'ensemble",
    links: [{ href: "/admin/dashboard", label: "Tableau de bord" }],
  },
  {
    label: "Réservations",
    links: [
      { href: "/admin/planning", label: "Planning" },
      { href: "/admin/bookings/new", label: "Nouvelle réservation" },
      { href: "/admin/schedule", label: "Horaires" },
    ],
  },
  {
    label: "Clients",
    links: [
      { href: "/admin/clients", label: "Clients" },
      { href: "/admin/legacy-clients", label: "Migration Doinsport" },
      { href: "/admin/wallets", label: "Wallets" },
    ],
  },
  {
    label: "Boutique",
    links: [
      { href: "/admin/tariffs", label: "Tarifs" },
      { href: "/admin/credit-packs", label: "Packs de crédits" },
      { href: "/admin/credit-pack-purchases", label: "Achats de crédits" },
      { href: "/admin/payments", label: "Paiements" },
    ],
  },
  {
    label: "Rapports",
    links: [
      { href: "/admin/reports", label: "Chiffre d'affaires" },
      { href: "/admin/audit-log", label: "Audit log" },
      { href: "/admin/incidents", label: "Incidents" },
    ],
  },
  {
    label: "Matériel & accès",
    links: [
      { href: "/admin/kiosks", label: "Kiosques" },
      { href: "/admin/terminals", label: "Terminaux" },
      { href: "/admin/sync", label: "Synchro Legacy" },
      { href: "/admin/access", label: "Accès" },
    ],
  },
  {
    label: "Réglages",
    links: [{ href: "/admin/settings", label: "Paramètres" }],
  },
];

const ALL_LINKS = NAV_GROUPS.flatMap((g) => g.links);

function NavLink({ href, label, active, onClick }: { href: string; label: string; active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-accent-600/15 text-accent-600" : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}

function NavGroups({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">{group.label}</div>
          <div className="flex flex-col gap-0.5">
            {group.links.map((link) => (
              <NavLink
                key={link.href}
                href={link.href}
                label={link.label}
                active={pathname.startsWith(link.href)}
                onClick={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

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
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (loading || isLoginPage) return;
    if (!user) router.push(`/admin/login?next=${encodeURIComponent(pathname)}`);
  }, [user, loading, isLoginPage, pathname, router]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (isLoginPage) return <>{children}</>;
  if (loading || !user) return <Spinner />;

  if (!ADMIN_ROLES.includes(user.role)) {
    return <ErrorBanner message="Accès réservé au personnel du club." />;
  }

  const currentLabel = ALL_LINKS.find((l) => pathname.startsWith(l.href))?.label ?? "Espace équipe";

  return (
    // Évade le `max-w-lg mx-auto` du layout racine (pensé pour les écrans
    // client mobile-first, CDC §53) : l'admin a besoin de toute la largeur
    // disponible sur desktop (tableaux, grille planning) tout en restant
    // sans effet sur mobile (le viewport est déjà plus étroit que max-w-lg).
    <div className="relative left-1/2 right-1/2 -mx-[50vw] flex w-screen max-w-none">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-800 bg-[#050912] md:flex">
        <Link href="/admin/dashboard" className="flex items-center gap-2 px-5 py-6">
          <Image src="/logo-horizontal.png" alt="Ardenne Padel" width={280} height={93} className="h-10 w-auto" />
        </Link>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <NavGroups pathname={pathname} />
        </div>
        <div className="border-t border-slate-800 px-4 py-3">
          <p className="truncate text-xs text-slate-400">{user.email}</p>
          <p className="mb-2 text-xs text-slate-400">{user.role}</p>
          <Link href="/" className="mb-2 block text-xs font-medium text-accent-600 hover:text-accent-500">
            ← Vue client
          </Link>
          <button
            onClick={() => {
              void logout().then(() => router.push("/admin/login"));
            }}
            className="text-xs font-medium text-slate-400 hover:text-red-400"
          >
            Déconnexion
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar mobile */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-black/40 bg-[#050912] px-4 py-3 md:hidden">
          <span className="font-heading text-sm font-semibold text-white">{currentLabel}</span>
          <button
            type="button"
            aria-label={drawerOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
            className="flex h-11 w-11 flex-col items-center justify-center gap-1.5 rounded-full text-white hover:bg-white/10"
          >
            <span className={`block h-0.5 w-6 bg-current transition-transform ${drawerOpen ? "translate-y-2 rotate-45" : ""}`} />
            <span className={`block h-0.5 w-6 bg-current transition-opacity ${drawerOpen ? "opacity-0" : ""}`} />
            <span className={`block h-0.5 w-6 bg-current transition-transform ${drawerOpen ? "-translate-y-2 -rotate-45" : ""}`} />
          </button>
        </header>

        {drawerOpen && (
          <div className="border-b border-white/10 bg-[#050912] px-3 py-4 md:hidden">
            <NavGroups pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            <div className="mt-4 border-t border-slate-800 pt-3">
              <p className="truncate px-3 text-xs text-slate-400">
                {user.email} · {user.role}
              </p>
              <Link href="/" className="mt-2 block px-3 text-xs font-medium text-accent-600 hover:text-accent-500">
                ← Vue client
              </Link>
              <button
                onClick={() => {
                  void logout().then(() => router.push("/admin/login"));
                }}
                className="mt-1 px-3 text-xs font-medium text-slate-400 hover:text-red-400"
              >
                Déconnexion
              </button>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-6">{children}</main>
      </div>
    </div>
  );
}
