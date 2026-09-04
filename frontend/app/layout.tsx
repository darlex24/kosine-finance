import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AuthProvider } from "@/components/AuthProvider";
import { CatalogProvider } from "@/components/CatalogProvider";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Kosine Finance — Kingdom Stewardship",
  description:
    "Global financial stewardship, investment and net-worth tracking for ministers of the gospel.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 pb-24 pt-6">
          <AuthProvider>
            <CatalogProvider>
              <SiteHeader />
              <main className="flex-1">{children}</main>
            </CatalogProvider>
          </AuthProvider>
          <footer className="mt-16 border-t border-white/5 pt-6 text-xs text-navy-300">
            Estimates only. Balances and valuations are what you record. Confirm
            registered-account room and donation totals against your own statements and
            official receipts.
          </footer>
        </div>
      </body>
    </html>
  );
}
