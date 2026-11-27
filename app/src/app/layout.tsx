import type { Metadata, Viewport } from "next";
import {
  Fraunces,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Arabic,
  Geist_Mono,
} from "next/font/google";
import "./globals.css";
import SmoothScrollProvider from "@/components/landing/SmoothScrollProvider";
import { TOUCH_BOOT_SCRIPT } from "@/lib/touchModeShared";

// viewportFit: "cover" lets the page extend under notches/home indicators
// so the play-mode chrome can pad itself with env(safe-area-inset-*) —
// without it those env() values are always 0 on iOS.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Type system — "warm sketchbook editorial":
//  - Fraunces (soft display serif, optical sizing) for headings. Latin only,
//    so every display font chain also lists --font-arabic (see globals.css).
//  - IBM Plex Sans for body text, with IBM Plex Sans Arabic as the same-
//    superfamily companion — the en/ar pairing stays cohesive by design.
//  - Geist Mono stays for machine-flavoured chrome (boot screen label).
const fraunces = Fraunces({
  variable: "--font-display-latin",
  subsets: ["latin"],
  axes: ["opsz"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  // Four Arabic weights (~140 KB) were <link rel=preload>ed for EVERY visitor,
  // English ones too, ahead of the LCP image. With preload off the browser
  // fetches a file only once Arabic text is actually painted (display: swap).
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  // Only the cabinet's "booting" label uses it.
  preload: false,
});

export const metadata: Metadata = {
  title: "Creatofolio",
  description: "An interactive, hand-drawn portfolio you can walk around in.",
  keywords: ["portfolio", "interactive portfolio", "hand-drawn", "creative"],
  openGraph: {
    title: "Creatofolio",
    description: "An interactive, hand-drawn portfolio you can walk around in.",
    type: "website",
    locale: "en_US",
    alternateLocale: "ar_AR",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Admin touch mode before first paint (no-op off /admin). */}
        <script dangerouslySetInnerHTML={{ __html: TOUCH_BOOT_SCRIPT }} />
      </head>
      <body
        className={`${fraunces.variable} ${plexSans.variable} ${plexArabic.variable} ${geistMono.variable} antialiased`}
      >
        <SmoothScrollProvider>{children}</SmoothScrollProvider>
      </body>
    </html>
  );
}
