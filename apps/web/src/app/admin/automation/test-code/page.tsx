"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorBanner } from "@/components/ui";

interface TestResult {
  granted: boolean;
  scope?: string;
  origin?: string;
}

const ORIGIN_LABELS: Record<string, string> = {
  V2_GENERATED: "Généré V2",
  LEGACY_IMPORTED: "Importé Legacy (Dual Run)",
  LEGACY_ONLY: "Doinsport (non synchronisé V2)",
  STAFF_MASTER: "Code staff",
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "#", "0", "⌫"];

// Page de test admin, sans matériel : rejoue côté serveur la même logique
// que la validation locale du Raspberry (mêmes sources/fenêtres de
// validité), pour vérifier le circuit code -> zone avant que le clavier
// physique (Dahua/Nano) soit câblé. Le "#" valide, comme sur un vrai clavier
// de contrôle d'accès.
export default function TestAccessCodePage() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  function pressKey(key: string) {
    setResult(null);
    setError(null);
    if (key === "⌫") {
      setCode((c) => c.slice(0, -1));
      return;
    }
    if (key === "#") {
      void submit();
      return;
    }
    setCode((c) => (c + key).slice(0, 50));
  }

  async function submit() {
    if (!code) return;
    setChecking(true);
    setError(null);
    try {
      const data = await api.post<TestResult>("/admin/automation/test-code", { code });
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de vérifier ce code.");
    } finally {
      setChecking(false);
      setCode("");
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold">Tester un code d&apos;accès</h1>
        <p className="mt-1 text-sm text-slate-500">
          Simule la validation faite par le Raspberry (mêmes règles), sans matériel. Terminez par <span className="font-mono">#</span> pour valider.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <Card className="flex w-full max-w-sm flex-col items-center gap-4">
        <div className="flex h-14 w-full items-center justify-center rounded-md bg-slate-900 font-mono text-2xl tracking-widest text-slate-100">
          {code ? code.replace(/./g, "•") : <span className="text-slate-600">Code…</span>}
        </div>

        <div className="grid w-full grid-cols-3 gap-2">
          {KEYS.map((key) => (
            <Button key={key} variant="secondary" disabled={checking} className="!w-full text-lg" onClick={() => pressKey(key)}>
              {key}
            </Button>
          ))}
        </div>

        {result && (
          <div
            className={`w-full rounded-md p-3 text-center text-sm font-semibold ${
              result.granted ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
            }`}
          >
            {result.granted ? "ACCÈS AUTORISÉ" : "ACCÈS REFUSÉ"}
            {result.granted && result.scope && (
              <p className="mt-1 text-xs font-normal">
                Zone : {result.scope}
                {result.origin && ` · ${ORIGIN_LABELS[result.origin] ?? result.origin}`}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
