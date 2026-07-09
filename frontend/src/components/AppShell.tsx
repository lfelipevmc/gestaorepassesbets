"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "./layout/Sidebar";
import { Toaster } from "./ui/Toast";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login");
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center animate-pulse">
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
        </div>
        <div className="text-muted text-sm">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Barra superior — apenas no celular/tablet */}
        <header className="lg:hidden sticky top-0 z-30 bg-surface-card/95 backdrop-blur border-b border-surface-border px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            className="p-1.5 -ml-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-surface-border transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-bold text-white text-sm">Haveres de Bets</span>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto min-w-0">{children}</main>
      </div>

      <Toaster />
    </div>
  );
}
