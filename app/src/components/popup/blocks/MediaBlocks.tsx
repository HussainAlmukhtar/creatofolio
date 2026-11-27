"use client";

// Pop-up media blocks: video, audio, screen (image/video with words on top).
//
// Privacy + weight: a YouTube/Vimeo video never loads the player until the
// visitor presses play (click-to-load); until then they see the author's
// poster (or a plain panel), and no request goes to the platform. Every iframe
// comes from resolveEmbed (the site's ONE allowlist) with EMBED_SANDBOX/ALLOW.
// Every src goes through safeMediaSrc (refused quietly = nothing renders).

import { useState, useSyncExternalStore } from "react";
import { Play } from "lucide-react";
import { EMBED_ALLOW, EMBED_SANDBOX, resolveEmbed } from "@/components/landing/blocks/EmbedBlock";
import { L, alignToCss } from "@/components/landing/blocks/shared";
import { safeMediaSrc } from "@/lib/safeUrl";
import type { AudioProps, ScreenProps, VideoProps } from "@/data/popupBlockTypes";

type Lang = "en" | "ar";

const ASPECT: Record<string, string> = {
  "16:9": "16 / 9",
  "4:3": "4 / 3",
  "1:1": "1 / 1",
  "9:16": "9 / 16",
  "3:4": "3 / 4",
};

const REDUCED = "(prefers-reduced-motion: reduce)";
/** Looping/autoplaying video stays still for visitors who asked for less motion. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(REDUCED);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED).matches,
    () => false
  );
}

/** Composer-only placeholder for a block with nothing to show yet. */
function Hint({ editor, children }: { editor?: boolean; children: React.ReactNode }) {
  return editor ? <p className="popup-block-hint">{children}</p> : null;
}

/** Add autoplay to a player URL (the visitor just pressed play). */
function withAutoplay(src: string): string {
  try {
    const u = new URL(src);
    u.searchParams.set("autoplay", "1");
    return u.toString();
  } catch {
    return src;
  }
}

// ─── Video ──────────────────────────────────────────────────────

export function VideoBlock({ p, language, editor }: { p: VideoProps; language: Lang; editor?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const reduced = useReducedMotion();
  const title = L(p.title, language) || (language === "ar" ? "فيديو" : "Video");
  const caption = L(p.caption, language);
  const aspectRatio = ASPECT[p.aspect] ?? ASPECT["16:9"];
  const poster = safeMediaSrc(p.poster, "image") ?? undefined;

  let media: React.ReactNode = null;
  if (p.source === "upload") {
    const src = safeMediaSrc(p.file, "media");
    if (!src) return <Hint editor={editor}>Video: choose or upload a video file in the panel on the right.</Hint>;
    const silentLoop = p.loop && !reduced;
    media = (
      <video
        src={src}
        poster={poster}
        aria-label={title}
        playsInline
        preload="metadata"
        // A loop plays silently like a GIF; otherwise normal controls.
        {...(silentLoop ? { autoPlay: !editor, muted: true, loop: true } : { controls: true, muted: p.loop })}
        className="popup-media__fill"
      />
    );
  } else {
    const r = resolveEmbed(p.url ?? "");
    if (r.kind === "empty") return <Hint editor={editor}>Video: paste a YouTube or Vimeo link in the panel on the right.</Hint>;
    if (r.kind === "unsupported")
      return <Hint editor={editor}>This link can&apos;t be shown. Use a YouTube, Vimeo or .mp4/.webm link.</Hint>;
    if (r.kind === "video") {
      media = (
        <video src={r.src} poster={poster} aria-label={title} controls playsInline preload="metadata" className="popup-media__fill" />
      );
    } else if (playing && !editor) {
      media = (
        <iframe
          src={withAutoplay(r.src)}
          title={title}
          sandbox={EMBED_SANDBOX}
          allow={EMBED_ALLOW}
          referrerPolicy="strict-origin-when-cross-origin"
          className="popup-media__fill border-0"
        />
      );
    } else {
      media = (
        <button
          type="button"
          className="popup-video__cover"
          onClick={() => setPlaying(true)}
          aria-label={language === "ar" ? `تشغيل: ${title}` : `Play: ${title}`}
        >
          {poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" className="popup-media__fill object-cover" />
          )}
          <span className="popup-video__play" aria-hidden="true">
            <Play size={26} fill="currentColor" />
          </span>
          {!poster && <span className="popup-video__title">{title}</span>}
          <span className="popup-video__note">
            {r.provider === "youtube" ? "YouTube" : "Vimeo"}
            {language === "ar" ? " · يبدأ عند الضغط" : " · loads when you press play"}
          </span>
        </button>
      );
    }
  }

  return (
    <figure className="popup-media">
      <div className="popup-media__frame" style={{ aspectRatio }}>
        {media}
      </div>
      {caption && <figcaption className="popup-media__caption">{caption}</figcaption>}
    </figure>
  );
}

// ─── Audio ──────────────────────────────────────────────────────

export function AudioBlock({ p, language, editor }: { p: AudioProps; language: Lang; editor?: boolean }) {
  const src = safeMediaSrc(p.file, "media");
  if (!src) return <Hint editor={editor}>Sound: choose or upload a sound file in the panel on the right.</Hint>;
  const title = L(p.title, language);
  const caption = L(p.caption, language);
  return (
    <figure className="popup-audio">
      {title && <p className="popup-audio__title">{title}</p>}
      <audio src={src} controls preload="none" aria-label={title || (language === "ar" ? "صوت" : "Sound")} />
      {caption && <figcaption className="popup-media__caption">{caption}</figcaption>}
    </figure>
  );
}

// ─── Screen (TV) ────────────────────────────────────────────────

export function ScreenBlock({ p, language, editor }: { p: ScreenProps; language: Lang; editor?: boolean }) {
  const reduced = useReducedMotion();
  const isVideo = p.mediaKind === "video";
  const src = safeMediaSrc(p.media, isVideo ? "media" : "image");
  const heading = L(p.heading, language);
  const text = L(p.text, language);
  if (!src && !heading && !text) {
    return <Hint editor={editor}>Screen: choose an image or video, then write the words on top.</Hint>;
  }
  const scrim = Math.max(0, Math.min(80, Number(p.scrim) || 0)) / 100;
  const pos = p.position === "top" ? "flex-start" : p.position === "bottom" ? "flex-end" : "center";
  const align = alignToCss(p.align);
  return (
    <div className="popup-screen" style={{ aspectRatio: ASPECT[p.aspect] ?? ASPECT["16:9"] }}>
      {src &&
        (isVideo ? (
          <video
            src={src}
            className="popup-media__fill object-cover"
            playsInline
            muted
            loop
            autoPlay={!editor && !reduced}
            preload="metadata"
            aria-hidden="true"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="popup-media__fill object-cover" />
        ))}
      {(heading || text) && (
        <div
          className="popup-screen__words"
          style={{
            justifyContent: pos,
            textAlign: align,
            alignItems: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
            background:
              p.position === "center"
                ? `rgb(0 0 0 / ${scrim})`
                : `linear-gradient(${p.position === "top" ? "180deg" : "0deg"}, rgb(0 0 0 / ${scrim}) 0%, rgb(0 0 0 / ${scrim * 0.6}) 45%, transparent 100%)`,
          }}
        >
          {heading && <p className="popup-screen__heading font-display">{heading}</p>}
          {text && <p className="popup-screen__text">{text}</p>}
        </div>
      )}
    </div>
  );
}
