"use client";

// ArcadeEditorStage — the arcade section in the editor: the REAL ArcadeScene
// (same component the site renders) showing the whole world, with editing
// layers on top:
//   - AssetOverlay for the scene elements (passed in by the canvas),
//   - ArcadeMachineOverlay (select / move / scale / rotate the machine, and
//     the 19:12 screen rect),
//   - ArcadeFrameOverlay (each camera as a frame on the world).
// A camera preview (scrub slider, "Preview click-in") swaps the view to what
// a visitor sees through the device frame; editing is paused meanwhile.

import { useMemo } from "react";
import type { DrawnSection } from "@/data/landingTypes";
import {
  ARCADE_MACHINE_IID,
  machineGeometry,
  resolveArcade,
  type ArcadeCamera,
  type ArcadeDeviceKey,
  type StoredArcadeConfig,
} from "@/data/arcadeConfig";
import { useLandingEditorStore } from "@/stores/landingEditorStore";
import ArcadeScene from "@/components/landing/ArcadeScene";
import { ArcadeMachineOverlay } from "./ArcadeMachineOverlay";
import { ArcadeFrameOverlay, type CameraTarget } from "./ArcadeFrameOverlay";
import { backdropBounds } from "@/lib/arcadeGuides";
import { isMachineLocked } from "@/lib/layerLock";
import { toggleMachineLockWithFeedback } from "@/lib/landingEditorActions";

/** Write a camera into the stored config for a device (rest or keyframe). */
export function withCamera(
  stored: StoredArcadeConfig,
  resolvedKeyframes: ReturnType<typeof resolveArcade>["desktop"]["scroll"]["keyframes"],
  device: ArcadeDeviceKey,
  t: CameraTarget,
  cam: ArcadeCamera
): StoredArcadeConfig {
  const dev = { ...stored[device] };
  if (t.kind === "rest") {
    dev.rest = cam;
  } else {
    const keyframes = resolvedKeyframes.map((k, i) => (i === t.index ? { ...k, camera: cam } : k));
    dev.scroll = { ...dev.scroll, keyframes };
  }
  return { ...stored, [device]: dev };
}

export function ArcadeEditorStage({
  section,
  language,
  device,
  active,
  renderOverlay,
}: {
  section: DrawnSection;
  language: "en" | "ar";
  device: ArcadeDeviceKey;
  /** The arcade section is the editor's current focus. */
  active: boolean;
  /** Build the section's AssetOverlay with extra hit targets inside it. */
  renderOverlay: (
    extra: React.ReactNode,
    machineLock?: { rect: { x: number; y: number; w: number; h: number }; onUnlock: () => void } | null
  ) => React.ReactNode;
}) {
  const arcade = useMemo(() => resolveArcade(section.arcade), [section.arcade]);
  const world = section.aspectRatio;
  const selectedAssetIid = useLandingEditorStore((s) => s.selectedAssetIid);
  const tool = useLandingEditorStore((s) => s.arcadeTool);
  const setTool = useLandingEditorStore((s) => s.setArcadeTool);
  const target = useLandingEditorStore((s) => s.arcadeCameraTarget);
  const preview = useLandingEditorStore((s) => s.arcadePreview);
  const setPreview = useLandingEditorStore((s) => s.setArcadePreview);
  const updateArcade = useLandingEditorStore((s) => s.updateArcade);
  const selectSection = useLandingEditorStore((s) => s.selectSection);
  const selectAsset = useLandingEditorStore((s) => s.selectAsset);
  const setTarget = useLandingEditorStore((s) => s.setArcadeCameraTarget);
  const overview = useLandingEditorStore((s) => s.arcadeOverview);
  const setOverview = useLandingEditorStore((s) => s.setArcadeOverview);

  // Overview: fit everything — the max zoom-out, plus any element placed
  // outside it — into the canvas, with a little margin.
  const overviewCam = useMemo(() => {
    const b = backdropBounds(arcade, world);
    let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    for (const a of section.assets) {
      x0 = Math.min(x0, a.x);
      y0 = Math.min(y0, a.y);
      x1 = Math.max(x1, a.x + a.w);
      y1 = Math.max(y1, a.y + a.h);
    }
    const scale = Math.min(1, 0.94 * Math.min(100 / (x1 - x0), 100 / (y1 - y0)));
    return { scale, focusX: (x0 + x1) / 2, focusY: (y0 + y1) / 2, rotation: 0 };
  }, [arcade, world, section.assets]);

  const machineSelected = active && selectedAssetIid === ARCADE_MACHINE_IID;
  const machineLocked = isMachineLocked(section.arcade);
  const previewing = active && preview !== null;
  const fa = arcade[device].frame.aspect.w / arcade[device].frame.aspect.h;

  const extra = (
    <>
      <ArcadeMachineOverlay
        arcade={arcade}
        world={world}
        device={device}
        selected={machineSelected}
        locked={machineLocked}
        tool={tool}
        onSelect={() => {
          if (!active) selectSection(section.iid);
          selectAsset(ARCADE_MACHINE_IID);
        }}
        onPlacement={(t) =>
          updateArcade(section.iid, (st) =>
            device === "desktop"
              ? { ...st, machine: { ...st.machine, ...t } }
              : {
                  ...st,
                  mobile: {
                    ...st.mobile,
                    machine: { ...arcade.mobile.machine, ...t },
                  },
                }
          )
        }
        onScreen={(scr) =>
          updateArcade(section.iid, (st) =>
            // Phones with their own drawing edit that drawing's screen rect.
            device === "mobile" && arcade.machine.phoneArt
              ? {
                  ...st,
                  machine: {
                    ...st.machine,
                    phoneArt: { ...arcade.machine.phoneArt, ...st.machine?.phoneArt, screen: scr },
                  },
                }
              : { ...st, machine: { ...st.machine, screen: scr } }
          )
        }
      />
      {active && (
        <ArcadeFrameOverlay
          arcade={arcade}
          world={world}
          device={device}
          active={tool === "frame"}
          target={target}
          onTarget={setTarget}
          onCamera={(t, cam) =>
            updateArcade(section.iid, (st) =>
              withCamera(st, arcade[device].scroll.keyframes, device, t, cam)
            )
          }
        />
      )}
    </>
  );

  return (
    <div className="arcade-editor-frame relative isolate bg-neutral-100" data-previewing={previewing || undefined}>
      {/* Top-left bar, buttons first: always in view, even when the canvas scrolls sideways. */}
      <div className="absolute left-2 top-1.5 z-[1001] flex flex-wrap items-center gap-1.5">
        {previewing && (
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-700"
            title="Stop the camera preview and go back to editing (or press Esc)"
          >
            ■ Stop preview
          </button>
        )}
        {active && !previewing && (tool === "frame" || tool === "screen") && (
          <button
            type="button"
            onClick={() => setTool("select")}
            className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-700"
            title={`Stop editing the ${tool === "frame" ? "camera frame" : "game screen box"} and go back to selecting (or press Esc)`}
          >
            ✓ Done editing {tool === "frame" ? "frame" : "screen"}
          </button>
        )}
        {active && !previewing && (
          <button
            type="button"
            onClick={() => setOverview(!overview)}
            className="rounded bg-black/70 px-2 py-0.5 text-[11px] text-white hover:bg-black/85"
            title="Zoom the canvas out to see (and edit) everything, including a backdrop's edges beyond the drawing area"
          >
            {overview ? "Back to drawing area" : "Overview"}
          </button>
        )}
        <div className="pointer-events-none rounded bg-black/70 px-2 py-0.5 text-[11px] text-white">
          {previewing
            ? `Camera preview · ${device === "mobile" ? "phone" : "desktop"} frame`
            : overview && active
              ? "Overview — everything, including beyond the drawing area"
              : "Arcade — the whole drawing. Frames show what each screen sees."}
        </div>
      </div>
      <ArcadeScene
        arcade={arcade}
        world={world}
        assets={section.assets}
        language={language}
        screen={<div className="arcade-editor-screen">GAME</div>}
        editor={{
          overlay: previewing
            ? undefined
            : renderOverlay(
                extra,
                machineLocked && machineSelected && tool === "select"
                  ? {
                      rect: machineGeometry(arcade, device, world).box,
                      onUnlock: () => void toggleMachineLockWithFeedback(section.iid),
                    }
                  : null
              ),
          camera: previewing ? preview : overview && active ? overviewCam : null,
          frameAspect: previewing ? fa : undefined,
        }}
      />
    </div>
  );
}
