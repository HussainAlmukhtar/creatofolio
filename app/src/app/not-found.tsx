import type { Metadata } from "next";
import Link from "next/link";
import ErrorShell, { ERROR_BTN_SOLID } from "@/components/site/ErrorShell";

export const metadata: Metadata = {
  title: "Page not found | Creatofolio",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <ErrorShell
      code="404"
      title="This page doesn't exist"
      titleAr="هذه الصفحة غير موجودة"
      message="It may have moved, or it was never written."
      messageAr="ربما انتقلت، أو لم تُكتب أصلًا."
    >
      <Link href="/" className={ERROR_BTN_SOLID}>
        Back home · العودة للرئيسية
      </Link>
    </ErrorShell>
  );
}
