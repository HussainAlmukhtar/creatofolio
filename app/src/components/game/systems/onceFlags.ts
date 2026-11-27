// Once-only triggers: "Once per visit" = sessionStorage, "Only the first time
// ever" = localStorage, keyed `once:<roomIid>:<objectIid>:<click|near>`
// (lib/objectActions.ts::onceKey). The pop-up lab's game harness keeps them
// in memory instead (no visitor storage is touched there) and can reset them.

import type { TriggerOnce } from "@/data/roomTypes";

/** The harness's flags, and the visitor's when storage is blocked. */
const harnessMemory = new Set<string>();
const fallbackMemory = new Set<string>();

function store(mode: TriggerOnce): Storage | null {
  try {
    return mode === "forever" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function onceUsed(key: string, mode: TriggerOnce | undefined, harness: boolean): boolean {
  if (!mode || mode === "never") return false;
  if (harness) return harnessMemory.has(key);
  if (fallbackMemory.has(key)) return true;
  try {
    return store(mode)?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markOnce(key: string, mode: TriggerOnce | undefined, harness: boolean) {
  if (!mode || mode === "never") return;
  if (harness) {
    harnessMemory.add(key);
    return;
  }
  // Memory too, so blocked storage (private mode) still holds for this tab.
  fallbackMemory.add(key);
  try {
    store(mode)?.setItem(key, "1");
  } catch {
    // Memory only.
  }
}

/** The lab's "Reset once-only steps" (harness memory only). */
export function resetHarnessOnce() {
  harnessMemory.clear();
}
