// Which surface a pop-up opens from. "game" = the room pop-up; the landing
// themes follow the hosting section's surface (paper vs digital) so the sheet
// blends with where the visitor clicked. Drives `data-popup-theme` on
// `.popup-surface` (globals.css), which sets the section ink tokens.
export type PopupTheme = "game" | "landing-paper" | "landing-digital";
