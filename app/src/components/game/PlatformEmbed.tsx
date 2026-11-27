"use client";

// PlatformEmbed — renders one embed (YouTube/Instagram/TikTok/Twitter/
// custom-iframe) with real oEmbed markup instead of dropping the URL into
// a bare iframe. Instagram/TikTok/Twitter require their own script +
// blockquote to actually render. Shared by the pop-up `platform-embed` block,
// each embed-kind item inside a `reel`, and the editor's previews.
//
// Safety: every iframe comes from resolveEmbed() (the site-wide allowlist in
// landing/blocks/EmbedBlock.tsx) and carries EMBED_SANDBOX; a "custom iframe"
// whose host isn't on that allowlist is refused. Social posts must point at
// their own platform's host.

import { useEffect } from "react";
import type { EmbedType } from "@/data/contentTypes";
import { loadEmbedScript, reprocessEmbeds } from "@/lib/embedScripts";
import { EMBED_ALLOW, EMBED_SANDBOX, resolveEmbed } from "@/components/landing/blocks/EmbedBlock";

interface Props {
  url: string;
  embedType?: EmbedType;
  /** Editor previews explain refusals; visitors just see nothing. */
  editor?: boolean;
}

const SOCIAL_HOSTS: Record<"instagram" | "tiktok" | "twitter", string[]> = {
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  twitter: ["twitter.com", "x.com"],
};

function socialUrlOk(url: string, platform: keyof typeof SOCIAL_HOSTS): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.replace(/^(www|m|mobile)\./, "");
    return SOCIAL_HOSTS[platform].includes(host);
  } catch {
    return false;
  }
}

function tiktokVideoId(url: string): string | undefined {
  return url.match(/\/video\/(\d+)/)?.[1];
}

function Refused({ editor, text }: { editor?: boolean; text: string }) {
  return editor ? <p className="text-sm italic opacity-70">{text}</p> : null;
}

export function PlatformEmbed({ url, embedType = "custom-iframe", editor }: Props) {
  const social = embedType === "instagram" || embedType === "tiktok" || embedType === "twitter";
  const socialOk = social && socialUrlOk(url, embedType);

  useEffect(() => {
    if (socialOk) loadEmbedScript(embedType).then(() => reprocessEmbeds(embedType));
  }, [socialOk, embedType, url]);

  if (!url) return <Refused editor={editor} text="No embed URL set." />;

  if (social) {
    if (!socialOk) return <Refused editor={editor} text="That link isn't from this platform." />;
    if (embedType === "instagram") {
      return (
        <blockquote
          className="instagram-media"
          data-instgrm-permalink={url}
          data-instgrm-version="14"
          style={{ margin: 0, width: "100%" }}
        >
          <a href={url} target="_blank" rel="noopener noreferrer">
            View on Instagram
          </a>
        </blockquote>
      );
    }
    if (embedType === "tiktok") {
      return (
        <blockquote
          className="tiktok-embed"
          cite={url}
          data-video-id={tiktokVideoId(url)}
          style={{ maxWidth: "100%", minWidth: 260, margin: "0 auto" }}
        >
          <section>
            <a target="_blank" href={url} rel="noopener noreferrer">
              View on TikTok
            </a>
          </section>
        </blockquote>
      );
    }
    return (
      <blockquote className="twitter-tweet">
        <a href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      </blockquote>
    );
  }

  // youtube + custom-iframe: allowlisted players only.
  const resolved = resolveEmbed(url);
  if (resolved.kind === "video") {
    return (
      <video src={resolved.src} controls preload="metadata" playsInline className="w-full rounded bg-black" />
    );
  }
  if (resolved.kind !== "iframe") {
    return <Refused editor={editor} text="This link can't be embedded. Use a YouTube or Vimeo link." />;
  }
  return (
    <div className="aspect-video w-full overflow-hidden rounded">
      <iframe
        src={resolved.src}
        className="h-full w-full border-0"
        title="Embedded video"
        loading="lazy"
        sandbox={EMBED_SANDBOX}
        allow={EMBED_ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
