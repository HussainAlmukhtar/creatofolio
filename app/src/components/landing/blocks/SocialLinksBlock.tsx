"use client";

// Social links block — a row of profile links with brand icons.
//
// Brand glyphs come from simple-icons (CC0, one named export per brand, so only
// the icons listed here end up in the bundle). LinkedIn is absent from
// simple-icons at LinkedIn's own request, so it — like "Website" and "Email" —
// uses a generic lucide glyph; every link carries the platform name as its
// accessible label either way, so the icon is never the only information.

import { Globe, Link as LinkIcon, Mail } from "lucide-react";
import {
  siArtstation,
  siBehance,
  siDiscord,
  siDribbble,
  siFacebook,
  siGithub,
  siInstagram,
  siPinterest,
  siThreads,
  siTiktok,
  siTwitch,
  siVimeo,
  siWhatsapp,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";
import { alignToCss } from "./shared";
import { EditorHint } from "./EditorHint";

export type SocialPlatform =
  | "instagram"
  | "x"
  | "threads"
  | "tiktok"
  | "youtube"
  | "vimeo"
  | "twitch"
  | "linkedin"
  | "github"
  | "behance"
  | "dribbble"
  | "artstation"
  | "pinterest"
  | "facebook"
  | "discord"
  | "whatsapp"
  | "email"
  | "website";

export interface SocialLinkItem {
  id: string;
  platform: SocialPlatform;
  url: string;
}

export interface SocialLinksProps {
  links: SocialLinkItem[];
  style: "icons" | "icons-labels";
  size: "sm" | "md" | "lg";
  align: "left" | "center" | "right";
  newTab: boolean;
}

const PLATFORMS: Record<SocialPlatform, { name: string; icon?: SimpleIcon }> = {
  instagram: { name: "Instagram", icon: siInstagram },
  x: { name: "X", icon: siX },
  threads: { name: "Threads", icon: siThreads },
  tiktok: { name: "TikTok", icon: siTiktok },
  youtube: { name: "YouTube", icon: siYoutube },
  vimeo: { name: "Vimeo", icon: siVimeo },
  twitch: { name: "Twitch", icon: siTwitch },
  linkedin: { name: "LinkedIn" },
  github: { name: "GitHub", icon: siGithub },
  behance: { name: "Behance", icon: siBehance },
  dribbble: { name: "Dribbble", icon: siDribbble },
  artstation: { name: "ArtStation", icon: siArtstation },
  pinterest: { name: "Pinterest", icon: siPinterest },
  facebook: { name: "Facebook", icon: siFacebook },
  discord: { name: "Discord", icon: siDiscord },
  whatsapp: { name: "WhatsApp", icon: siWhatsapp },
  email: { name: "Email" },
  website: { name: "Website" },
};

/** Select options for the inspector, in display order. */
export const SOCIAL_PLATFORM_OPTIONS = (Object.keys(PLATFORMS) as SocialPlatform[]).map(
  (value) => ({ value, label: PLATFORMS[value].name })
);

/**
 * The href to render, or null to skip the link. Email accepts a bare address
 * (mailto: added); everything else must be an http(s) URL — a pasted
 * `javascript:` URL must never reach an href on the public page.
 */
export function socialHref(platform: SocialPlatform, raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (platform === "email") {
    const addr = v.replace(/^mailto:/i, "");
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? `mailto:${addr}` : null;
  }
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const SIZE_PX = { sm: 18, md: 24, lg: 32 } as const;

function PlatformIcon({ platform, px }: { platform: SocialPlatform; px: number }) {
  const icon = PLATFORMS[platform]?.icon;
  if (icon) {
    return (
      <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor" aria-hidden="true">
        <path d={icon.path} />
      </svg>
    );
  }
  const Generic = platform === "email" ? Mail : platform === "website" ? Globe : LinkIcon;
  return <Generic size={px} aria-hidden="true" />;
}

export function SocialLinksBlock({
  props,
  editor,
}: {
  props: SocialLinksProps;
  editor?: boolean;
}) {
  const px = SIZE_PX[props.size] ?? SIZE_PX.md;
  const links = (props.links ?? [])
    .map((l) => ({ ...l, href: socialHref(l.platform, l.url) }))
    .filter((l) => l.href || editor);
  const justify =
    alignToCss(props.align) === "left"
      ? "justify-start"
      : alignToCss(props.align) === "right"
        ? "justify-end"
        : "justify-center";

  if (links.length === 0) {
    return (
      <EditorHint editor={editor}>Social links — add profiles in the settings panel.</EditorHint>
    );
  }

  return (
    <ul className={`m-0 flex list-none flex-wrap items-center gap-3 p-0 ${justify}`}>
      {links.map((l) => {
        const name = PLATFORMS[l.platform]?.name ?? "Link";
        const external = l.platform !== "email" && props.newTab;
        return (
          <li key={l.id}>
            <a
              // In the editor an unset/invalid URL still shows (so the owner
              // sees the slot) but goes nowhere.
              href={l.href ?? undefined}
              aria-label={props.style === "icons" ? name : undefined}
              title={name}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer me" : "me"}
              className={`inline-flex items-center gap-2 rounded-full text-section-ink transition hover:opacity-70 focus-visible:outline-3 focus-visible:outline-offset-4 ${
                props.style === "icons" ? "p-2" : "px-3.5 py-1.5 ring-1 ring-[color:var(--line)] hover:ring-section-ink"
              } ${l.href ? "" : "opacity-40"}`}
              // Touch target: the icon-only variant still meets 44px.
              style={props.style === "icons" ? { minWidth: 44, minHeight: 44, justifyContent: "center" } : undefined}
            >
              <PlatformIcon platform={l.platform} px={px} />
              {props.style === "icons-labels" && <span className="text-sm font-medium">{name}</span>}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
