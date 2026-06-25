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
      },
    },
  },
  plugins: [],
} satisfies Config;
