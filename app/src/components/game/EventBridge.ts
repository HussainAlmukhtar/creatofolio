// EventBridge — singleton event emitter for React ↔ Phaser communication.
//
// Phaser scenes emit events here; React components subscribe via useEventBridge hook.
// React components emit events here; Phaser scenes listen during create().

type EventCallback = (...args: unknown[]) => void;

class EventBridgeClass {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  /** Is anyone listening? (Action steps that wait on React skip when not.) */
  has(event: string): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

// Singleton — same instance shared by React and Phaser
export const EventBridge = new EventBridgeClass();

// Event name constants
export const EVENTS = {
  // Phaser → React
  ROOM_CHANGED: "room:changed",
  /** An action step needs React UI (pop-up, link/email/download, dialogue).
   *  Payload: ActionUiRequest (components/game/actionUi.ts); React calls its
   *  `done` when the visitor is finished, and the chain continues. */
  ACTION_UI: "action:ui",
  /** Every step the ActionRunner runs (QA log in the pop-up lab). */
  ACTION_STEP: "action:step",
  /** A "shop" step: open the visitor's character creator. */
  OPEN_CHARACTER_CREATOR: "avatar:open-creator",

  // React → Phaser
  AVATAR_UPDATED: "avatar:updated",
  LANGUAGE_CHANGED: "language:changed",
  NAVIGATE_TO_ROOM: "room:navigate",
  UI_MODAL: "ui:modal", // true = modal open (disable game input), false = closed

  // Landing → Phaser (arcade hero ↔ fullscreen play)
  PLAY_MODE_ENTER: "play:enter",
  PLAY_MODE_EXIT: "play:exit",

  // Editor — React → Phaser (preview panel)
  EDITOR_LOAD_ROOM: "editor:load-room",
  EDITOR_ROOM_UPDATED: "editor:room-updated",
  EDITOR_PREVIEW_MODE: "editor:preview-mode",
} as const;
