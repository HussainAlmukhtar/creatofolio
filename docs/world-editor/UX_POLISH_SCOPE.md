# World editor — UX polish scope

Scope for making the room editor (`/admin/editor`) and World map
(`/admin/editor/world`) feel smooth, predictable and accessible. Follows the
functional audit (data-loss fixes, hover/Easter eggs, multi-world). This pass
changes *how things feel*, not what the data looks like.

## Goals

1. **Drag, resize and rotate feel direct.** What you see while dragging is
   exactly what you get on release — no jump, no flicker, one undo step per
   gesture.
2. **Precision without fiddling.** Live snapping (grid + alignment), axis lock,
   aspect lock, live position/size readout.
3. **Handles stay usable at any zoom.** Vertex and entry-point handles are a
   constant size on screen.
4. **Keyboard-first where it matters.** Every canvas action reachable from the
   keyboard, with a live screen-reader announcement of what changed.
5. **Forgiving.** Destructive actions offer Undo right in the toast.
6. **Respect reduced motion** in the game's hover/Easter-egg effects.

## Items

### Canvas — objects
| # | Item | Why |
|---|------|-----|
| C1 | One store action per transform (`transformObject`) | Resize used to write position, size and rotation separately: 3 undo steps + a flicker frame between them. |
| C2 | `flipEnabled={false}`, min size, larger anchors, anchor/border styling | Dragging an edge past the opposite edge mirrored the sprite; 8px anchors were hard to hit. |
| C3 | Live grid snap while dragging | Snapping only on release made objects jump when you let go. |
| C4 | Shift-drag locks to the dominant axis | Standard design-tool affordance for straight moves. |
| C5 | Live readout (x/y while moving, w×h while resizing, ° while rotating) | Precise placement without the side panel. |
| C6 | Move cursor over draggable objects | Signals “you can grab this”. |
| C7 | Shift = free resize, Alt = resize from centre hint | Corners keep aspect by default (Konva); make it discoverable. |

### Canvas — polygons & points
| # | Item | Why |
|---|------|-----|
| P1 | Walkable/hitbox polygon follows the vertex live during drag, committed once on release | The fill stayed behind until release; committing per frame would flood undo. |
| P2 | Vertex, midpoint and entry-point handles sized in screen pixels | At 50% zoom handles were 4px dots. |

### Canvas — navigation
| # | Item | Why |
|---|------|-----|
| N1 | Smooth, delta-proportional wheel zoom; pinch-zoom support | Trackpads fire many tiny wheel events → each was a full 8% step (way too fast). |
| N2 | `+` / `-` zoom, `0` fit, `F` frame selection | Keyboard navigation. |
| N3 | Drop-target highlight when dragging assets over the canvas | Feedback that the drop will land. |

### Keyboard & accessibility
| # | Item | Why |
|---|------|-----|
| K1 | `Tab` / `Shift+Tab` cycle through objects; `Enter` opens content; `[` / `]` layer order | Canvas is otherwise mouse-only. |
| K2 | Canvas is a focusable `role="application"` with an ARIA live region announcing selection, moves, resizes and deletions | Screen-reader users get feedback for every canvas action. |
| K3 | Visible `:focus-visible` rings across the editor | Keyboard users can see where focus is. |
| K4 | Delete shows an **Undo** action in the toast | Recover from a slip without knowing Ctrl+Z. |
| K5 | Number fields: draft while typing, commit valid numbers, Enter/Escape, ↑/↓ (Shift ×10) | Clearing a field used to snap it to 0 mid-edit. |

### World map
| # | Item | Why |
|---|------|-----|
| W1 | Live grid snap while dragging rooms (gridvania) | Drop-only snapping jumped on release. |
| W2 | Keyboard: `Enter` open, `Esc` deselect, arrows nudge selected room | Keyboard access. |
| W3 | Move cursor on room cards | Affordance. |

### Game
| # | Item | Why |
|---|------|-----|
| G1 | `prefers-reduced-motion` tones hover/Easter-egg motion down to fades/sparkles | Accessibility. |

## Follow-up pass (done)
Originally out of scope, completed in the follow-up:
- **Multi-select** — Shift/Ctrl-click (canvas, objects list, outline),
  box-select by dragging on empty canvas, Ctrl+A; group move and group
  resize/rotate as one undo step; align (6) and distribute (3+) in the side
  panel; arrows / Delete (with Undo) / Ctrl+D act on the whole selection.
- **Layer lock** — every positioned layer has a stored lock (backdrops locked
  by default): padlock on each outline row (always visible on touch), Lock /
  Unlock in the inspector header, the ⋯ / right-click / long-press menus and
  **Ctrl/⌘+Shift+L**. A locked object can't move, resize, rotate or nudge, is
  skipped by box-select / Ctrl+A / Tab, and clicks pass through it; it stays
  selectable from the outline. Undoable, saved with the draft.
- **Touch** — pinch zoom + two-finger pan (room canvas and World map),
  one-finger pan on empty canvas, tap select, long-press menu, finger-sized
  handles, 36px hit targets; under 1024px the properties panel is a drawer.
- **Landing editor** — Tab-reachable elements, focus selects, Enter edits
  text, Delete with Undo, live-region announcements, keyboard section-height
  handle, pointer-down selection for touch.
- **Starter elements** — the drawings in `public/elements` replace the
  placeholder boxes everywhere; Add menu palette; "Hotspot only" objects.

## Still open
- Group resize keeps each object's own aspect (Konva) — no "scale group
  proportionally around a pivot" mode yet.
- Touch: no on-screen modifier for multi-select (use the objects list).

## Acceptance
- `npx tsc --noEmit`, `npm run lint` (no new errors) and `next build` pass.
- Manual: drag, resize, rotate, polygon edit, entry-point drag, keyboard
  shortcuts and undo behave as described above.
