import type { Config } from "tailwindcss";

// Kosine brand: deep navy ground, metallic gold accent.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#eef2f9",
          100: "#d5deef",
          300: "#8fa3c8",
          500: "#2c4372",
          700: "#15294f",
          800: "#0e1c38",
          900: "#081226",
          950: "#050b18",
        },
        gold: {
          100: "#f7ecc9",
          300: "#e8d191",
          400: "#dcbb63",
          500: "#c9a227",
          600: "#a8851b",
          700: "#7d6213",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(5,11,24,.4), 0 12px 32px -12px rgba(5,11,24,.7)",
        gold: "0 0 0 1px rgba(201,162,39,.35), 0 8px 24px -12px rgba(201,162,39,.5)",
      },
      backgroundImage: {
        "gold-sheen":
          "linear-gradient(135deg,#7d6213 0%,#c9a227 35%,#f7ecc9 50%,#c9a227 65%,#7d6213 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
