"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";

export function NavBar() {
  const { user, loading, logout } = useSession();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold text-emerald-700">
          Ardenne Padel
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {!loading && user && (
            <>
              <Link href="/bookings" className="text-slate-700 hover:text-emerald-700">
                Mes réservations
              </Link>
              <Link href="/wallet" className="text-slate-700 hover:text-emerald-700">
                Wallet
              </Link>
              <Link href="/profile" className="text-slate-700 hover:text-emerald-700">
                Profil
              </Link>
              <button
                onClick={() => {
                  void logout().then(() => router.push("/"));
                }}
                className="text-slate-500 hover:text-red-600"
              >
                Déconnexion
              </button>
            </>
          )}
          {!loading && !user && (
            <Link href="/login" className="font-medium text-emerald-700 hover:text-emerald-800">
              Connexion
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
