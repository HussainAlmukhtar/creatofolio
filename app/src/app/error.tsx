"use client";

import { useEffect } from "react";
import ErrorShell, { ERROR_BTN, ERROR_BTN_SOLID } from "@/components/site/ErrorShell";

export default function ErrorPage({
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
    <ErrorShell
      code="Oops"
      title="Something tore a page"
      titleAr="حدث خلل ما"
      message="That wasn't supposed to happen. Try again, or head back home."
      messageAr="لم يكن هذا متوقعًا. حاول مرة أخرى أو عد إلى الرئيسية."
    >
      <button type="button" onClick={reset} className={ERROR_BTN_SOLID}>
        Try again · حاول مرة أخرى
      </button>
      {/* Plain anchor: a full load clears whatever state broke. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className={ERROR_BTN}>
        Home · الرئيسية
      </a>
    </ErrorShell>
  );
}
