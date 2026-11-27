// embedScripts — loads platform oEmbed scripts (Instagram/TikTok/Twitter)
// on demand and dedupes across multiple embeds on the same page, so N
// embeds of the same platform only fetch the script once.

declare global {
  interface Window {
    instgrm?: { Embeds: { process: () => void } };
    twttr?: { widgets: { load: () => void } };
  }
}

type ScriptPlatform = "instagram" | "tiktok" | "twitter";

const PLATFORM_SCRIPT_SRC: Record<ScriptPlatform, string> = {
  instagram: "https://www.instagram.com/embed.js",
  tiktok: "https://www.tiktok.com/embed.js",
  twitter: "https://platform.twitter.com/widgets.js",
};

const loadedScripts = new Map<string, Promise<void>>();

/** Loads a platform's embed script once, resolving immediately on repeat calls. */
export function loadEmbedScript(platform: ScriptPlatform): Promise<void> {
  const src = PLATFORM_SCRIPT_SRC[platform];
  const existing = loadedScripts.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    // Resolve on error too — a blocked/ad-blocked script shouldn't hang the
    // caller forever, it just means that embed stays as its fallback link.
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.body.appendChild(script);
  });

  loadedScripts.set(src, promise);
  return promise;
}

/**
 * Re-scans the DOM for new embed blockquotes after they mount. TikTok's
 * embed.js installs its own MutationObserver and picks up new
 * `.tiktok-embed` blockquotes automatically, so it needs no manual call.
 */
export function reprocessEmbeds(platform: ScriptPlatform): void {
  if (platform === "instagram") {
    window.instgrm?.Embeds.process();
  } else if (platform === "twitter") {
    window.twttr?.widgets.load();
  }
}
