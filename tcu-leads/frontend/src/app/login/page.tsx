"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, getMe } from "@/lib/api";
import { setAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(email, password);
      localStorage.setItem("token", res.data.access_token);
      const me = await getMe();
      setAuth(res.data.access_token, me.data);
      router.push("/painel");
    } catch (err: any) {
      setError(err.response?.data?.detail || "E-mail ou senha inválidos");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-surface">
      {/* brilho de fundo */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[32rem] h-[32rem] rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[32rem] h-[32rem] rounded-full bg-blue-500/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-primary to-blue-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-primary/30">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">TCU Leads</h1>
          <p className="text-muted text-sm mt-1">Inteligência de captação de oportunidades no TCU</p>
        </div>
        <form onSubmit={handleSubmit} className="card space-y-4 shadow-xl">
          {error && <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">{error}</div>}
          <div>
            <label className="label">E-mail</label>
            <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Senha</label>
            <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
        <p className="text-center text-[11px] text-muted/70 mt-6">Ferramenta interna · Dados de fontes públicas · Sem captação ativa (OAB 205/2021)</p>
      </div>
    </div>
  );
}
