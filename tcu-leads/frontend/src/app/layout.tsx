import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TCU Leads",
  description: "Captação de oportunidades a partir do Diário Eletrônico/BTCU e das APIs do TCU",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-surface text-slate-100 min-h-screen">{children}</body>
    </html>
  );
}
