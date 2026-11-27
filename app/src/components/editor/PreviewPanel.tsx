"use client";

// PreviewPanel — embeds a Phaser game instance for WYSIWYG room preview.
//
// Shows exactly how BaseRoomScene renders the room, with click-to-walk
// for testing feel. Syncs room config from Zustand via EventBridge.

import { useEffect, useRef, useCallback } from "react";
import Phaser from "phaser";
import { useEditorStore } from "@/stores/editorStore";
import { EventBridge, EVENTS } from "@/components/game/EventBridge";
import PreviewScene from "@/components/game/scenes/PreviewScene";

export function PreviewPanel({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const currentRoomConfig = useEditorStore((s) => s.currentRoomConfig);

  // Create Phaser game on mount
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: 1520,
      height: 960,
      parent: containerRef.current,
      backgroundColor: "#2A2520",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [PreviewScene],
      physics: {
        default: "arcade",
        arcade: { debug: false, gravity: { x: 0, y: 0 } },
      },
      render: { pixelArt: false, antialias: true },
      input: { touch: true },
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    // Start preview scene with the current room config
    const roomConfig = useEditorStore.getState().currentRoomConfig;
    if (roomConfig) {
      game.scene.start("PreviewScene", { roomConfig });
    }

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  // Sync room config changes to preview via EventBridge
  const prevConfigRef = useRef(currentRoomConfig);
  useEffect(() => {
    if (!gameRef.current || !currentRoomConfig) return;
    // Only push updates when config actually changes
    if (prevConfigRef.current !== currentRoomConfig) {
      prevConfigRef.current = currentRoomConfig;
      EventBridge.emit(EVENTS.EDITOR_ROOM_UPDATED, currentRoomConfig);
    }
  }, [currentRoomConfig]);

  // Manual refresh button handler
  const handleRefresh = useCallback(() => {
    const roomConfig = useEditorStore.getState().currentRoomConfig;
    if (roomConfig) {
      EventBridge.emit(EVENTS.EDITOR_ROOM_UPDATED, roomConfig);
    }
  }, []);

  return (
    <div className="border-t border-neutral-700 bg-neutral-900 flex flex-col flex-shrink-0">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-800 border-b border-neutral-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-neutral-300">
            Live Preview
          </span>
          <span className="text-xs text-neutral-500">
            Click to walk around — test room feel
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="px-2 py-0.5 rounded text-xs bg-neutral-700 text-neutral-300 hover:bg-neutral-600 transition-colors"
            title="Refresh preview with latest changes"
          >
            Refresh
          </button>
          <button
            onClick={onClose}
            className="px-2 py-0.5 rounded text-xs bg-neutral-700 text-neutral-300 hover:bg-red-700 hover:text-white transition-colors"
            title="Close preview panel"
          >
            Close
          </button>
        </div>
      </div>
      {/* Phaser container */}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "300px" }}
        className="bg-black"
      />
    </div>
  );
}
