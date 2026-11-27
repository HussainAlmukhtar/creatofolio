// Section visibility — the ONE place that decides whether a DrawnSection is
// shown to visitors. Read by the public renderer (DrawnPageSections) to skip
// hidden sections and by the editor (outline badges, canvas dimming, the
// section form's status line) so the two can never disagree.
//
// Three independent knobs, all on DrawnSection (schemaVersion 5):
//   - `hidden`   — hide everywhere. Non-destructive: still editable.
//   - `hiddenOn` — hide on one device class. Resolved in CSS (see
//                  globals.css `.drawn-section-device`), NOT here: the server
//                  can't know the visitor's device, so a JS check would render
//                  one thing on the server and another after hydration.
//   - `schedule` — show only inside [startISO, endISO). Either end optional.
//                  Needs a "now", which callers pass in (see useMinuteClock)
//                  rather than reading Date.now() here, so server render and
//                  hydration can agree on the same instant.
//
// The arcade section (`containsGame`) is exempt: it's the home hero, rendered
// by HeroSection outside the normal section map, and hiding the game isn't a
// thing the CMS offers.

import type { DrawnSection } from "./landingTypes";

export type ScheduleState = "none" | "upcoming" | "live" | "ended";

/** Parse an ISO bound; invalid/empty strings count as "no bound". */
function parseBound(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Where `now` falls relative to the section's schedule window. Start is
 * inclusive, end exclusive. `now === null` means "unknown" (e.g. during
 * server render of a client-only page) — reported as "upcoming" for any
 * section that HAS a schedule, so it stays hidden until a real clock is known
 * rather than flashing in and back out.
 */
export function scheduleState(
  section: Pick<DrawnSection, "schedule">,
  now: number | null
): ScheduleState {
  const start = parseBound(section.schedule?.startISO);
  const end = parseBound(section.schedule?.endISO);
  if (start === null && end === null) return "none";
  if (now === null) return "upcoming";
  if (start !== null && now < start) return "upcoming";
  if (end !== null && now >= end) return "ended";
  return "live";
}

/**
 * Whether the section renders at all for a visitor at `now` — the hidden flag
 * plus the schedule window. Per-device hiding is layered on top in CSS.
 */
export function isSectionPubliclyVisible(
  section: DrawnSection,
  now: number | null
): boolean {
  if (section.containsGame) return true;
  if (section.hidden) return false;
  const s = scheduleState(section, now);
  return s === "none" || s === "live";
}

/** Whether a section is hidden on a device class (mobile / desktop). */
export function isHiddenOnDevice(
  section: DrawnSection,
  device: "mobile" | "desktop"
): boolean {
  return !section.containsGame && Boolean(section.hiddenOn?.[device]);
}

/**
 * Short human reason a section is NOT currently visible on `device`, or null
 * when it is. Used for editor badges/overlays — one string so the outline,
 * canvas and form all say the same thing.
 */
export function sectionHiddenReason(
  section: DrawnSection,
  now: number | null,
  device: "mobile" | "desktop"
): string | null {
  if (section.containsGame) return null;
  if (section.hidden) return "Hidden — not shown on the live site";
  const s = scheduleState(section, now);
  if (s === "upcoming") return "Scheduled — not live yet";
  if (s === "ended") return "Schedule ended — no longer shown";
  if (isHiddenOnDevice(section, device)) return `Hidden on ${device}`;
  return null;
}
