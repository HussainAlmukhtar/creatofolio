"use client";

// One row of a pop-up link list (Links block, Contact block). `href` must
// already have been through safeHref: null renders the row inert.

import {
  Briefcase,
  Camera,
  Code2,
  Globe,
  Link as LinkIcon,
  Mail,
  MessageCircle,
  Phone,
  Store,
  type LucideIcon,
} from "lucide-react";
import { isExternalHref } from "@/lib/safeUrl";

// lucide-react ships no brand marks; generic semantic substitutes.
export const LINK_ICONS: Record<string, LucideIcon> = {
  email: Mail,
  linkedin: Briefcase,
  store: Store,
  github: Code2,
  twitter: MessageCircle,
  instagram: Camera,
  website: Globe,
  phone: Phone,
};

export const LINK_ICON_OPTIONS = [
  { value: "", label: "No icon" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "website", label: "Website" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "github", label: "GitHub" },
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "X / Twitter" },
  { value: "store", label: "Store" },
];

export function LinkRow({
  href,
  label,
  icon,
  iconKey,
  dirLtr,
}: {
  href: string | null;
  label: string;
  icon?: LucideIcon;
  iconKey?: string;
  /** Email addresses and phone numbers read left-to-right in Arabic too. */
  dirLtr?: boolean;
}) {
  // No icon key = no icon; an unknown key = a plain link icon.
  const Icon = icon ?? (iconKey ? (LINK_ICONS[iconKey] ?? LinkIcon) : undefined);
  const inner = (
    <>
      {Icon && <Icon size={18} aria-hidden="true" />}
      <span dir={dirLtr ? "ltr" : undefined}>{label}</span>
    </>
  );
  return (
    <li>
      {href ? (
        <a
          href={href}
          className="popup-links__row"
          {...(isExternalHref(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {inner}
        </a>
      ) : (
        // Unsafe/empty link: shown, but inert.
        <span className="popup-links__row" aria-disabled="true">
          {inner}
        </span>
      )}
    </li>
  );
}
