import type { Metadata } from "next";
import { Source_Sans_3, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

const sans = Source_Sans_3({ variable: "--font-sans", subsets: ["latin"] });
const mono = Spline_Sans_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GrantBridge",
  description: "I-LEAD grant subledger",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
