"use client";

// Last resort: replaces the root layout, so no site CSS or fonts are loaded.
// Styled inline to match the paper look.

import { useEffect } from "react";

const btn = {
  display: "inline-block",
  minHeight: 44,
  lineHeight: "44px",
  padding: "0 24px",
  borderRadius: 999,
  border: "1px solid #2B2420",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  font: "inherit",
} as const;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "grid",
          placeItems: "center",
          padding: "64px 24px",
          background: "#F8F5EE",
          color: "#2B2420",
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 448 }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.25em", textTransform: "uppercase", color: "#57493E", margin: "0 0 32px" }}>
            Creatofolio
          </p>
          <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 40, lineHeight: 1.15, margin: 0 }}>
            Something tore a page
          </h1>
          <p style={{ fontSize: 18, color: "#57493E", marginTop: 12 }}>
            That wasn&apos;t supposed to happen. Try again, or head back home.
          </p>
          <div dir="rtl" lang="ar" style={{ marginTop: 32, borderTop: "1px solid rgba(43,36,32,.16)", paddingTop: 24 }}>
            <h2 style={{ fontSize: 24, margin: 0 }}>حدث خلل ما</h2>
            <p style={{ color: "#57493E", marginTop: 8 }}>لم يكن هذا متوقعًا. حاول مرة أخرى أو عد إلى الرئيسية.</p>
          </div>
          <div style={{ marginTop: 40, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={reset} style={{ ...btn, background: "#2B2420", color: "#FDFCF8" }}>
              Try again · حاول مرة أخرى
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ ...btn, background: "transparent", color: "#2B2420" }}>
              Home · الرئيسية
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
