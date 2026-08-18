import type { Metadata, Viewport } from "next";
import { Poppins, Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/lib/session-context";
import { NavBar } from "@/components/nav-bar";

// Polices officielles Ardenne Padel (ardenne-padel.be) : Poppins pour les
// titres, Inter pour le texte courant.
const poppins = Poppins({
  variable: "--font-heading",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ardenne Padel",
  description: "Réservez votre terrain de padel — Ardenne Padel",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Ardenne Padel",
  },
};

// CDC §53 : mobile-first, PWA installable.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#050912",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${poppins.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-slate-950 text-slate-100">
        <SessionProvider>
          <NavBar />
          <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
