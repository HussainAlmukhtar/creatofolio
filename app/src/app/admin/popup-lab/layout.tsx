import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pop-up lab" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
