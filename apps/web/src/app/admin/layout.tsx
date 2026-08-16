"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { ErrorBanner, Spinner } from "@/components/ui";
import type { Role } from "@/lib/types";

const ADMIN_ROLES: Role[] = ["STAFF", "ADMIN", "SUPER_ADMIN"];

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
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 pb-3 text-sm">
        <Link href="/admin/dashboard" className="font-medium text-emerald-700 hover:text-emerald-800">
          Tableau de bord
        </Link>
        <Link href="/admin/planning" className="font-medium text-emerald-700 hover:text-emerald-800">
          Planning
        </Link>
        <Link href="/admin/clients" className="font-medium text-emerald-700 hover:text-emerald-800">
          Clients
        </Link>
        <span className="ml-auto text-xs text-slate-400">
          {user.email} · {user.role}
        </span>
        <button
          onClick={() => {
            void logout().then(() => router.push("/admin/login"));
          }}
          className="text-xs text-slate-500 hover:text-red-600"
        >
          Déconnexion
        </button>
      </nav>
      {children}
    </div>
  );
}
