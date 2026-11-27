// The cabinet screen's resting state until the game has booted. Lives in its
// own tiny module (not GameWrapper) so the landing page can paint it at once
// while the heavy game chunk is still being fetched.

/**
 * CRT-style boot screen shown over the cabinet screen until the game is
 * fully ready (catalog + rooms fetched, Phaser booted, first scene
 * started). Styled as the machine's own boot state so it reads as
 * intentional at any cabinet zoom level — never as broken UI text.
 */
export default function GameBootScreen({ visible, posterUrl }: { visible: boolean; posterUrl?: string }) {
  return (
    <div
      className="game-boot-screen"
      data-visible={visible ? "true" : "false"}
      data-poster={posterUrl ? "true" : undefined}
    >
      {posterUrl ? (
        // The author's still for the screen (Arcade Studio → poster), shown
        // until the first scene runs — same fade as the CRT boot state.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posterUrl} alt="" aria-hidden="true" draggable={false} className="game-boot-screen__poster" />
      ) : (
        <>
          <div className="game-boot-screen__led" />
          <div className="game-boot-screen__label">booting</div>
        </>
      )}
    </div>
  );
}
