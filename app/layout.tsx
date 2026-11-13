// app/layout.tsx
import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// UI text: a clean, slightly technical grotesk with tabular figures.
const fontSans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// IDs, keys, IPs, HWIDs, code: unambiguous 0/O and 1/l/I.
const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AtomProtect | Lua Script Protection & Access Gateway",
  description: "Cryptographic IP-locking, in-game loader verification, and live heartbeat telemetry for Roblox script creators.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark scroll-smooth ${fontSans.variable} ${fontMono.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-fg antialiased selection:bg-accent/30 selection:text-fg">
        {children}
      </body>
    </html>
  );
}
