import type { Metadata } from "next";

export const metadata: Metadata = { title: "Loading screen" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
