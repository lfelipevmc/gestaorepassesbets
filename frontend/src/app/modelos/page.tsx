"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Os modelos de cobrança foram consolidados na página de Cobranças (aba "Modelos de Cobrança").
export default function ModelosRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/cobrancas"); }, [router]);
  return null;
}
