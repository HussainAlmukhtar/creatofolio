import { create } from "zustand";

// Whether the owner's auth session has lapsed. Fed by useOwnerSessionWatch and
// by the write guard (lib/writeGuard.ts); read by SessionLostBanner.

interface SessionState {
  lost: boolean;
  markLost: () => void;
  markOk: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  lost: false,
  markLost: () => set((s) => (s.lost ? s : { lost: true })),
  markOk: () => set((s) => (s.lost ? { lost: false } : s)),
}));
