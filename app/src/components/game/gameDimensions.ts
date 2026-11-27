// Shared game canvas dimensions — the single source of truth for the
// fixed 1520×960 design resolution on the LANDING side of the app.
//
// Mirrors ROOM_WIDTH / ROOM_HEIGHT in src/data/roomTypes.ts (the game's
// authoring resolution). Kept as a separate tiny module so landing
// components (CabinetStage) can import the numbers without pulling the
// whole room type surface into their bundle.

export const GAME_WIDTH = 1520;
export const GAME_HEIGHT = 960;
/** 1520 / 960 = 19:12 ≈ 1.5833 */
export const GAME_ASPECT = GAME_WIDTH / GAME_HEIGHT;
