// Shared look for the public error pages (404, runtime error): the sketchbook
// paper of the maintenance page, English first with the Arabic line under it.
// No hooks, so server (not-found) and client (error) pages can both use it.

import type { ReactNode } from "react";

export default function ErrorShell({
  code,
  title,
  titleAr,
  message,
  messageAr,
  children,
}: {
  code: string;
  title: string;
  titleAr: string;
  message: string;
  messageAr: string;
  children: ReactNode;
}) {
  return (
    <main
      data-paper="sketchbook"
      data-grain="true"
      className="paper-material grid min-h-svh place-items-center px-6 py-16 text-section-ink"
    >
      <div className="w-full max-w-md text-center">
        <p className="mb-8 text-xs font-semibold uppercase tracking-[0.25em] text-section-ink-soft">
          Creatofolio
        </p>
        <p className="font-display text-7xl font-semibold leading-none text-[color:var(--accent-brand)]">{code}</p>
        <h1 className="mt-6 font-display text-4xl font-semibold leading-tight md:text-5xl">{title}</h1>
        <p className="mt-3 text-lg leading-relaxed text-section-ink-soft">{message}</p>
        <div dir="rtl" lang="ar" className="mt-8 border-t border-[color:var(--line)] pt-6 text-center">
          <h2 className="font-display text-2xl font-semibold">{titleAr}</h2>
          <p className="mt-2 text-section-ink-soft">{messageAr}</p>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">{children}</div>
      </div>
    </main>
  );
}

export const ERROR_BTN =
  "inline-flex min-h-11 items-center rounded-full border border-[color:var(--ink)] px-6 text-sm font-semibold transition hover:-translate-y-0.5";
export const ERROR_BTN_SOLID = `${ERROR_BTN} bg-[color:var(--ink)] text-[color:var(--paper-0)]`;
