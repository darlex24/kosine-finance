import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AuthProvider } from "@/components/AuthProvider";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Kosine Finance — Kingdom Stewardship",
  description:
    "Canadian personal finance and Kingdom stewardship for ministers, leaders and members.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA" className={inter.variable}>
      <body>
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 pb-24 pt-6">
          <AuthProvider>
            <SiteHeader />
            <main className="flex-1">{children}</main>
          </AuthProvider>
          <footer className="mt-16 border-t border-white/5 pt-6 text-xs text-navy-300">
            Estimates only. Confirm registered-account room on your CRA Notice of
            Assessment and donation totals against your official receipts.
          </footer>
        </div>
      </body>
    </html>
  );
}
