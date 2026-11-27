// Draft preview layout — exists only to mark the route noindex. The page
// itself is a client component (it renders the Phaser-backed landing page),
// and client components can't export `metadata`.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Draft preview",
  robots: { index: false, follow: false },
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
