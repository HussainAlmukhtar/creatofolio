"use client";

// Pop-up portfolio blocks: project card, file download, contact.
// Links go through safeHref (unsafe = shown but inert); images through
// safeMediaSrc. The contact block's form is the site's Form block, so it is
// hidden from visitors until Site settings → Forms has a destination (the
// composer shows it with a "not connected" note).

import { Download, FileText, Mail, Music, Phone } from "lucide-react";
import { L } from "@/components/landing/blocks/shared";
import { FormBlock, type FormProps } from "@/components/landing/blocks/FormBlock";
import { isExternalHref, safeHref, safeMediaSrc } from "@/lib/safeUrl";
import { formatBytes } from "@/lib/landingMedia";
import type { ContactProps, FileDownloadProps, ProjectCardProps } from "@/data/popupBlockTypes";
import { LinkRow } from "./LinkRow";

type Lang = "en" | "ar";

function Hint({ editor, children }: { editor?: boolean; children: React.ReactNode }) {
  return editor ? <p className="popup-block-hint">{children}</p> : null;
}

const ext = (href: string) => (isExternalHref(href) ? { target: "_blank", rel: "noopener noreferrer" } : {});

// ─── Project card ───────────────────────────────────────────────

export function ProjectCardBlock({ p, language }: { p: ProjectCardProps; language: Lang }) {
  const cover = safeMediaSrc(p.cover, "image");
  const title = L(p.title, language);
  const role = L(p.role, language);
  const meta = [role, p.year?.trim()].filter(Boolean).join(" · ");
  const tags = L(p.tags, language)
    .split(/[,،]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const description = L(p.description, language);
  const links = (p.links ?? []).filter((l) => l.url?.trim());
  return (
    <article className="popup-project">
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" className="popup-project__cover" loading="lazy" />
      )}
      <div className="popup-project__body">
        {title && <h3 className="popup-project__title font-display">{title}</h3>}
        {meta && <p className="popup-project__meta">{meta}</p>}
        {tags.length > 0 && (
          <ul className="popup-project__tags">
            {tags.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
        {description && <p className="popup-project__text">{description}</p>}
        {links.length > 0 && (
          <div className="popup-project__links">
            {links.map((l) => {
              const href = safeHref(l.url);
              const label = L(l.label, language) || l.url;
              return href ? (
                <a key={l.id} href={href} className="popup-project__link" {...ext(href)}>
                  {label}
                </a>
              ) : (
                <span key={l.id} className="popup-project__link" aria-disabled="true">
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── File download ──────────────────────────────────────────────

/** Supabase Storage serves `?download=<name>` as an attachment (the HTML
 *  `download` attribute is ignored for another origin). */
function downloadHref(url: string, name: string): string {
  if (!/\/storage\/v1\/object\/public\//.test(url)) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("download", name || u.pathname.split("/").pop() || "file");
    return u.toString();
  } catch {
    return url;
  }
}

export function FileDownloadBlock({ p, language, editor }: { p: FileDownloadProps; language: Lang; editor?: boolean }) {
  const href = safeHref(p.file);
  if (!p.file?.trim()) return <Hint editor={editor}>File: choose or upload a PDF or sound file in the panel on the right.</Hint>;
  const label = L(p.label, language) || p.fileName || (language === "ar" ? "تنزيل الملف" : "Download the file");
  const description = L(p.description, language);
  const isAudio = /\.(mp3|m4a|aac|ogg|oga|opus|wav|weba|flac)(\?|$)/i.test(p.file);
  const kind = isAudio ? (language === "ar" ? "صوت" : "Sound") : "PDF";
  const size = formatBytes(p.bytes);
  const Icon = isAudio ? Music : FileText;
  const inner = (
    <>
      <span className="popup-file__icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <span className="popup-file__text">
        <span className="popup-file__label">{label}</span>
        {description && <span className="popup-file__desc">{description}</span>}
        <span className="popup-file__meta">{[kind, size].filter(Boolean).join(" · ")}</span>
      </span>
      <Download size={18} className="popup-file__go" aria-hidden="true" />
    </>
  );
  return href ? (
    <a href={downloadHref(href, p.fileName)} className="popup-file" target="_blank" rel="noopener noreferrer" download={p.fileName || ""}>
      {inner}
    </a>
  ) : (
    <span className="popup-file" aria-disabled="true">
      {inner}
    </span>
  );
}

// ─── Contact ────────────────────────────────────────────────────

const CONTACT_FORM: Omit<FormProps, "formName"> = {
  fields: [
    { id: "name", label: { en: "Name", ar: "الاسم" }, name: "firstname", type: "text", required: true },
    { id: "email", label: { en: "Email", ar: "البريد الإلكتروني" }, name: "email", type: "email", required: true },
    { id: "message", label: { en: "Message", ar: "الرسالة" }, name: "message", type: "textarea", required: true },
  ],
  submitLabel: { en: "Send", ar: "إرسال" },
  successMessage: { en: "Thanks — your message is on its way.", ar: "شكرًا — رسالتك في الطريق." },
  align: "left",
};

export function ContactBlock({ p, language, editor }: { p: ContactProps; language: Lang; editor?: boolean }) {
  const intro = L(p.intro, language);
  const email = p.email?.trim();
  const phone = p.phone?.trim();
  const links = (p.links ?? []).filter((l) => l.url?.trim());
  const nothing = !intro && !email && !phone && !links.length && !p.showForm;
  if (nothing) return <Hint editor={editor}>Contact: add an email, phone number or links in the panel on the right.</Hint>;
  return (
    <div className="popup-contact">
      {intro && <p className="popup-contact__intro">{intro}</p>}
      {(email || phone || links.length > 0) && (
        <ul className="popup-links">
          {email && (
            <LinkRow href={safeHref(`mailto:${email}`)} icon={Mail} label={email} dirLtr />
          )}
          {phone && (
            <LinkRow href={safeHref(`tel:${phone.replace(/[^\d+]/g, "")}`)} icon={Phone} label={phone} dirLtr />
          )}
          {links.map((l) => (
            <LinkRow key={l.id} href={safeHref(l.url)} iconKey={l.icon} label={L(l.label, language) || l.url} />
          ))}
        </ul>
      )}
      {p.showForm && (
        <FormBlock props={{ ...CONTACT_FORM, formName: p.formName || "contact" }} language={language} editor={editor} />
      )}
    </div>
  );
}
