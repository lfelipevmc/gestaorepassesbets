"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    router.replace(token ? "/leads" : "/login");
  }, [router]);
  return <div className="min-h-screen flex items-center justify-center text-muted">Carregando...</div>;
}
