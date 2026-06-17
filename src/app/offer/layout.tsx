import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";

// Root layout for the public, top-level /offer/[token] artifact embed.
// This route lives OUTSIDE the [locale] segment (which provides its own
// <html>/<body> root), so the segment needs its own root document. The
// embedded ArtifactViewer renders its own full-page chrome and resolves
// language from each artifact's locale, so this shell stays intentionally
// minimal — just the document, the Inter font token, and the design tokens
// from globals.css that the viewer theme references.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function OfferLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
