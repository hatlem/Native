"use client";

// Last-resort error boundary. It replaces the ROOT layout, so it catches what
// app/[locale]/error.tsx cannot: an error thrown by the locale layout itself
// (it runs several database queries) or by a route outside [locale]. Without
// it the user gets Next's unbranded, untranslated default page.
//
// Because the root layout is gone, this file must render its own <html> and
// <body>, cannot rely on globals.css or the next-intl provider, and so
// carries inline styles and its own small copy table. The locale is read
// from the URL's first path segment.

import { useEffect } from "react";

type Copy = { title: string; body: string; retry: string; home: string; ref: string };

const COPY: Record<string, Copy> = {
  en: {
    title: "Something went wrong",
    body: "The page could not be loaded. This is on our side — nothing you entered has been lost on purpose. Try again in a moment.",
    retry: "Try again",
    home: "Back to start",
    ref: "Error reference",
  },
  no: {
    title: "Noe gikk galt",
    body: "Siden kunne ikke lastes. Feilen ligger hos oss. Prøv igjen om et øyeblikk.",
    retry: "Prøv igjen",
    home: "Til forsiden",
    ref: "Feilreferanse",
  },
  sv: {
    title: "Något gick fel",
    body: "Sidan kunde inte laddas. Felet ligger hos oss. Försök igen om en stund.",
    retry: "Försök igen",
    home: "Till startsidan",
    ref: "Felreferens",
  },
  da: {
    title: "Noget gik galt",
    body: "Siden kunne ikke indlæses. Fejlen ligger hos os. Prøv igen om et øjeblik.",
    retry: "Prøv igen",
    home: "Til forsiden",
    ref: "Fejlreference",
  },
  de: {
    title: "Etwas ist schiefgelaufen",
    body: "Die Seite konnte nicht geladen werden. Der Fehler liegt bei uns. Bitte versuchen Sie es gleich noch einmal.",
    retry: "Erneut versuchen",
    home: "Zur Startseite",
    ref: "Fehlerreferenz",
  },
  fi: {
    title: "Jokin meni vikaan",
    body: "Sivua ei voitu ladata. Vika on meidän päässämme. Yritä hetken kuluttua uudelleen.",
    retry: "Yritä uudelleen",
    home: "Etusivulle",
    ref: "Virheviite",
  },
};

function localeFromPath(): string {
  if (typeof window === "undefined") return "en";
  const seg = window.location.pathname.split("/")[1] ?? "";
  return seg in COPY ? seg : "en";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = localeFromPath();
  const c = COPY[locale];

  useEffect(() => {
    console.error(error);
  }, [error]);

  const button: React.CSSProperties = {
    display: "inline-block",
    padding: "0.7rem 1.2rem",
    borderRadius: 8,
    font: "inherit",
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
    border: "1px solid #0a0b0d",
  };

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f6f6f4",
          color: "#0a0b0d",
          fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          lineHeight: 1.5,
        }}
      >
        <main style={{ maxWidth: 520, padding: "2rem 1.25rem", textAlign: "center" }}>
          <div style={{ fontWeight: 700, letterSpacing: "0.02em", marginBottom: "2rem" }}>NativeSpin</div>
          <h1 style={{ fontSize: "1.75rem", margin: "0 0 0.75rem" }}>{c.title}</h1>
          <p style={{ margin: "0 0 1.5rem", color: "#3f434b" }}>{c.body}</p>
          {error.digest ? (
            <p style={{ margin: "0 0 1.5rem", fontSize: "0.875rem", color: "#5b6068" }}>
              {c.ref}: <code>{error.digest}</code>
            </p>
          ) : null}
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={reset} style={{ ...button, background: "#0a0b0d", color: "#ffffff" }}>
              {c.retry}
            </button>
            {/* A full navigation on purpose: the client router state is broken. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href={`/${locale}`} style={{ ...button, background: "transparent", color: "#0a0b0d" }}>
              {c.home}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
