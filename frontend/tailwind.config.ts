import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#1a56db", dark: "#1e429f", light: "#3b82f6" },
        surface: { DEFAULT: "#1e2433", light: "#252d3d", border: "#2d3748", card: "#1a2030" },
        success: "#22c55e",
        warning: "#f59e0b",
        danger: "#ef4444",
        muted: "#94a3b8",
        // Série categórica validada (dataviz) para gráficos no tema escuro
        chart: { c1: "#3987e5", c2: "#199e70", c3: "#c98500", c4: "#e66767" },
      },
      fontFamily: {
        sans: [
          "-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Segoe UI",
          "Inter", "Roboto", "Helvetica Neue", "Arial", "sans-serif",
        ],
      },
      boxShadow: {
        card: "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 30px -18px rgba(0,0,0,0.6)",
        lift: "inset 0 1px 0 rgba(255,255,255,0.05), 0 18px 40px -20px rgba(0,0,0,0.7)",
        btn: "0 6px 16px -8px rgba(26,86,219,0.6)",
      },
    },
  },
  plugins: [],
} satisfies Config;
