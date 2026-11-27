// Minimal uuid v4 helper. Wraps `crypto.randomUUID()` (Node 19+, all modern
// browsers). Centralised so the migration script and the editor store call
// the same source — easier to swap to deterministic uuidv5 later if a
// migration needs replayability.
//
// Returns a lowercase RFC-4122 v4 uuid.

export function newIid(): string {
  // crypto.randomUUID is available in: Node 19+, all evergreen browsers,
  // and Edge runtime. Falls through to a manual v4 only if the runtime is
  // ancient — shouldn't happen in this codebase but cheap insurance.
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback: manual v4. Not cryptographically strong but iids only need to
  // be unique, not secret.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
