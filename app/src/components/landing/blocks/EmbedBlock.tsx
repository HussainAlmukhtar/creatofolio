"use client";

// Embed block — a video from YouTube, Vimeo, or a direct video file.
//
// Deliberately an ALLOWLIST, not "paste any URL into an iframe": an arbitrary
// iframe can run anything on the page's visitors (tracking, phishing UI, a
// clickjacking frame), and the CMS owner pastes links from anywhere. Known
// providers are rewritten to their official embed URLs (YouTube through the
// privacy-enhanced youtube-nocookie.com domain, which sets no cookies until
// the visitor presses play); a direct .mp4/.webm/.ogg link plays in a native
// <video>. Anything else renders a clear "unsupported link" notice instead of
// silently embedding it.
//
// resolveEmbed() is THE iframe allowlist for the whole site: pop-up embeds
// (incl. legacy "custom iframe" content) go through it too. Every iframe it
// produces is rendered with EMBED_SANDBOX + EMBED_ALLOW.

import type { Localized } from "@/data/landingTypes";
import { L } from "./shared";
import { EditorHint } from "./EditorHint";

export interface EmbedProps {
  url: string;
  /** Accessible title for the frame / video (screen readers announce it). */
  title: Localized;
  aspect: "16:9" | "4:3" | "1:1" | "9:16";
  rounded: boolean;
}

export type ResolvedEmbed =
  | { kind: "iframe"; src: string; provider: "youtube" | "vimeo" }
  | { kind: "video"; src: string }
  | { kind: "unsupported" }
  | { kind: "empty" };

const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** Sandbox for every allowlisted embed: players need scripts + their own
 *  origin; popups (and escaping the sandbox) so "Watch on YouTube" opens a
 *  normal tab. No forms, no top navigation. */
export const EMBED_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";
export const EMBED_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";

/** YouTube start time: "90", "90s", "1m30s", "1h2m3s" → seconds (0 if none). */
function parseStartSeconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Turn a pasted link into something safe to render. Pure — unit-testable. */
export function resolveEmbed(raw: string): ResolvedEmbed {
  const input = raw.trim();
  if (!input) return { kind: "empty" };
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { kind: "unsupported" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { kind: "unsupported" };
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");

  // YouTube: watch?v=, youtu.be/<id>, /shorts/<id>, /embed/<id>, /live/<id>
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      id = m ? m[1] : null;
    }
    if (!id || !YT_ID.test(id)) return { kind: "unsupported" };
    const start = parseStartSeconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
    const qs = new URLSearchParams({ rel: "0" });
    if (start > 0) qs.set("start", String(start));
    return {
      kind: "iframe",
      provider: "youtube",
      src: `https://www.youtube-nocookie.com/embed/${id}?${qs}`,
    };
  }

  // Vimeo: vimeo.com/<id>[/<hash>], player.vimeo.com/video/<id>
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/^\/(?:video\/)?(\d{5,12})(?:\/([0-9a-f]{6,20}))?/);
    if (!m) return { kind: "unsupported" };
    const qs = new URLSearchParams({ dnt: "1" });
    const hash = m[2] ?? u.searchParams.get("h");
    if (hash) qs.set("h", hash);
    return { kind: "iframe", provider: "vimeo", src: `https://player.vimeo.com/video/${m[1]}?${qs}` };
  }

  // A direct video file (e.g. uploaded to Supabase Storage).
  if (u.protocol === "https:" && /\.(mp4|webm|ogg|ogv|mov)$/i.test(u.pathname)) {
    return { kind: "video", src: u.toString() };
  }

  return { kind: "unsupported" };
}

const ASPECT: Record<EmbedProps["aspect"], string> = {
  "16:9": "16 / 9",
  "4:3": "4 / 3",
  "1:1": "1 / 1",
  "9:16": "9 / 16",
};

export function EmbedBlock({
  props,
  language,
  editor,
}: {
  props: EmbedProps;
  language: "en" | "ar";
  editor?: boolean;
}) {
  const resolved = resolveEmbed(props.url ?? "");
  const title = L(props.title, language) || "Embedded video";
  const frameCls = `relative w-full overflow-hidden bg-black/5 ${props.rounded ? "rounded-xl" : ""}`;
  const aspectRatio = ASPECT[props.aspect] ?? ASPECT["16:9"];

  if (resolved.kind === "empty" || resolved.kind === "unsupported") {
    return (
      // Editor-only: an unset or unembeddable link renders nothing publicly.
      <EditorHint editor={editor} className="h-full" style={{ aspectRatio }}>
        {resolved.kind === "empty"
          ? "Video — paste a YouTube, Vimeo or .mp4 link in the settings panel."
          : "This link can't be embedded. Use a YouTube, Vimeo or .mp4/.webm link."}
      </EditorHint>
    );
  }

  return (
    <div className={frameCls} style={{ aspectRatio }}>
      {resolved.kind === "iframe" ? (
        <iframe
          src={resolved.src}
          title={title}
          loading="lazy"
          sandbox={EMBED_SANDBOX}
          allow={EMBED_ALLOW}
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
          // In the editor the canvas overlay handles clicks; keep the frame
          // from stealing focus/scroll while the owner arranges the page.
          tabIndex={editor ? -1 : undefined}
        />
      ) : (
        <video
          src={resolved.src}
          title={title}
          aria-label={title}
          controls
          preload="metadata"
          playsInline
          className="absolute inset-0 h-full w-full bg-black object-contain"
        />
      )}
    </div>
  );
}
