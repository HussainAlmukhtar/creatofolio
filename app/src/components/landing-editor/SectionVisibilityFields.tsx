"use client";

// SectionVisibilityFields — the "Visibility" group in the section settings
// panel: hide the section, hide it per device, or bound it to a date window.
// Pure editor for DrawnSection.hidden / hiddenOn / schedule; the rules that
// turn those into "shown or not" live in data/sectionVisibility.ts, shared with
// the public renderer, so the status line here always matches the live site.

import type { DrawnSection } from "@/data/landingTypes";
import { scheduleState } from "@/data/sectionVisibility";
import { useMinuteClock } from "@/lib/useMinuteClock";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

// <input type="datetime-local"> speaks LOCAL wall-clock time with no zone
// ("2026-12-01T09:00"); the schema stores absolute ISO instants. Convert at the
// boundary so the author picks times in their own zone and visitors everywhere
// see the section flip at the same real instant.
function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value); // parsed as local time
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function SectionVisibilityFields({
  section,
  onChange,
}: {
  section: DrawnSection;
  onChange: (partial: Partial<DrawnSection>) => void;
}) {
  const now = useMinuteClock();

  if (section.containsGame) {
    return (
      <div className="space-y-1.5">
        <Label className="text-muted-foreground">Visibility</Label>
        <p className="text-[11px] text-muted-foreground">
          The arcade section is always shown — it hosts the game.
        </p>
      </div>
    );
  }

  const schedule = section.schedule ?? {};
  const setSchedule = (next: { startISO?: string; endISO?: string }) => {
    const cleaned = {
      ...(next.startISO ? { startISO: next.startISO } : {}),
      ...(next.endISO ? { endISO: next.endISO } : {}),
    };
    onChange({
      schedule: Object.keys(cleaned).length ? cleaned : undefined,
    });
  };
  const setHiddenOn = (device: "mobile" | "desktop", value: boolean) => {
    const next = { ...section.hiddenOn, [device]: value || undefined };
    onChange({
      hiddenOn: next.mobile || next.desktop ? next : undefined,
    });
  };

  const state = scheduleState(section, now);
  const invalidRange =
    schedule.startISO &&
    schedule.endISO &&
    Date.parse(schedule.endISO) <= Date.parse(schedule.startISO);
  const bothDevices = section.hiddenOn?.mobile && section.hiddenOn?.desktop;

  let status: string;
  if (section.hidden) status = "Hidden — visitors won't see this section.";
  else if (invalidRange) status = "“Show until” is before “Show from” — it will never show.";
  else if (state === "upcoming" && schedule.startISO)
    status = `Scheduled — goes live ${formatWhen(schedule.startISO)}.`;
  else if (state === "ended") status = "Schedule ended — no longer shown.";
  else if (bothDevices) status = "Hidden on every device — visitors won't see it.";
  else if (state === "live" && schedule.endISO)
    status = `Live now, until ${formatWhen(schedule.endISO)}.`;
  else status = "Visible to visitors.";
  const warn =
    section.hidden || invalidRange || state === "upcoming" || state === "ended" || bothDevices;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <Label className="text-muted-foreground">Visibility</Label>

      <div className="flex items-center gap-2">
        <Switch
          size="sm"
          id="section-hidden"
          checked={Boolean(section.hidden)}
          onCheckedChange={(v) => onChange({ hidden: v || undefined })}
        />
        <Label htmlFor="section-hidden">Hide section</Label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            id="section-hide-mobile"
            checked={Boolean(section.hiddenOn?.mobile)}
            onCheckedChange={(v) => setHiddenOn("mobile", v)}
          />
          <Label htmlFor="section-hide-mobile">Hide on mobile</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            id="section-hide-desktop"
            checked={Boolean(section.hiddenOn?.desktop)}
            onCheckedChange={(v) => setHiddenOn("desktop", v)}
          />
          <Label htmlFor="section-hide-desktop">Hide on desktop</Label>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="section-show-from" className="text-muted-foreground">
          Show from (optional)
        </Label>
        <div className="flex gap-1">
          <Input
            id="section-show-from"
            type="datetime-local"
            value={isoToLocalInput(schedule.startISO)}
            onChange={(e) =>
              setSchedule({ ...schedule, startISO: localInputToIso(e.target.value) })
            }
          />
          {schedule.startISO && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setSchedule({ ...schedule, startISO: undefined })}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="section-show-until" className="text-muted-foreground">
          Show until (optional)
        </Label>
        <div className="flex gap-1">
          <Input
            id="section-show-until"
            type="datetime-local"
            value={isoToLocalInput(schedule.endISO)}
            onChange={(e) =>
              setSchedule({ ...schedule, endISO: localInputToIso(e.target.value) })
            }
          />
          {schedule.endISO && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setSchedule({ ...schedule, endISO: undefined })}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <p
        className={`text-[11px] ${warn ? "text-amber-400" : "text-muted-foreground"}`}
      >
        {status}
      </p>
      <p className="text-[11px] text-muted-foreground">
        Hidden sections stay editable here (shown dimmed) and are saved with the
        page, so version history keeps them too. Times are in your local zone.
      </p>
    </div>
  );
}
