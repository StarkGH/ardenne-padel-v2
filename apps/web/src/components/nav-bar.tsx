"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";

export function NavBar() {
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Referme le menu à chaque changement de page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // L'espace équipe (/admin) a son propre sidebar + topbar : éviter la
  // double barre de navigation empilée.
  if (pathname.startsWith("/admin")) return null;

  return (
    <header className="sticky top-0 z-20 border-b border-black/40 bg-[#050c18]">
      <nav className="mx-auto flex max-w-lg items-center justify-between px-4 py-2.5">
        <Link href="/" className="flex items-center py-1">
          <Image src="/logo-horizontal.png" alt="Ardenne Padel" width={300} height={100} priority className="h-11 w-auto sm:h-12" />
        </Link>
        <button
          type="button"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-11 w-11 flex-col items-center justify-center gap-1.5 rounded-full text-white transition-colors hover:bg-white/10"
        >
          <span className={`block h-0.5 w-6 bg-current transition-transform ${open ? "translate-y-2 rotate-45" : ""}`} />
          <span className={`block h-0.5 w-6 bg-current transition-opacity ${open ? "opacity-0" : ""}`} />
          <span className={`block h-0.5 w-6 bg-current transition-transform ${open ? "-translate-y-2 -rotate-45" : ""}`} />
        </button>
      </nav>

      {open && (
        <div className="border-t border-white/10 bg-[#050c18]">
          <div className="mx-auto flex max-w-lg flex-col gap-1 px-4 pt-2 pb-4 text-base">
            {!loading && user && (
              <>
                <Link href="/bookings" className="rounded-lg px-3 py-2.5 text-slate-200 hover:bg-white/5 hover:text-accent-600">
                  Mes réservations
                </Link>
                <Link href="/wallet" className="rounded-lg px-3 py-2.5 text-slate-200 hover:bg-white/5 hover:text-accent-600">
                  Wallet
                </Link>
                <Link href="/profile" className="rounded-lg px-3 py-2.5 text-slate-200 hover:bg-white/5 hover:text-accent-600">
                  Profil
                </Link>
                <button
                  onClick={() => {
                    void logout().then(() => router.push("/"));
                  }}
                  className="rounded-lg px-3 py-2.5 text-left text-slate-400 hover:bg-white/5 hover:text-red-400"
                >
                  Déconnexion
                </button>
              </>
            )}
            {!loading && !user && (
              <Link href="/login" className="rounded-lg px-3 py-2.5 font-medium text-accent-600 hover:bg-white/5">
                Connexion
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
