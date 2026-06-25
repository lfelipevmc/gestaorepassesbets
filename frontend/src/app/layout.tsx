import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gestão de Haveres de Bets",
  description: "Sistema de gestão de repasses de direito de imagem - Agentes Operadores de Apostas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-surface text-slate-100 min-h-screen">{children}</body>
    </html>
  );
}
