import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/** CDC §53 : boutons suffisamment grands pour un usage tactile — jamais en dessous de 44px de hauteur. */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const base = "min-h-11 w-full rounded-full px-5 py-3 text-base font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  // Boutons pill vert lime / texte noir : identiques aux CTA d'ardenne-padel.be.
  const variants = {
    primary: "bg-accent-600 text-black hover:bg-accent-300 active:bg-accent-700",
    secondary: "border-2 border-white bg-transparent text-white hover:bg-white/10 active:bg-white/15",
    danger: "bg-red-600 text-white hover:bg-red-500 active:bg-red-700",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-100 shadow-sm ${className}`}>{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white placeholder-slate-500 focus:border-accent-600 focus:outline-none focus:ring-1 focus:ring-accent-600 ${props.className ?? ""}`}
    />
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">{message}</div>;
}

export function InfoBanner({ message }: { message: string }) {
  return <div className="rounded-xl border border-secondary-800 bg-secondary-800/20 px-4 py-3 text-sm text-secondary-100">{message}</div>;
}

export function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-800 border-t-accent-600" />
    </div>
  );
}

export function PriceTag({ cents, currency = "EUR" }: { cents: number; currency?: string }) {
  const amount = (cents / 100).toLocaleString("fr-BE", { style: "currency", currency });
  return <span>{amount}</span>;
}
