"use client";

// ArcadeScene — the arcade hero as a layered scene seen through a camera.
// Presentational and shared: the public hero (CabinetStage drives the camera +
// play mode) and the editor's Arcade Studio (static, identity camera, editing
// overlays) both render it, so what the author arranges is what ships.
//
//   .arcade-stage   the device frame (aspect per device, fitted to the
//                   viewport, clips) — CSS picks desktop/mobile values
//   .arcade-world   the scene (section.aspectRatio), moved by the camera vars
//     scene assets  z-ordered around…
//     .arcade-machine  ONE grouped object: back art → screen → CTA → front art
//
// UI chrome never lives in here (it would scale with the camera) — see
// CabinetStage's document.body portal.

import type React from "react";
import type { DrawnAsset } from "@/data/landingTypes";
import {
  BUILTIN_CTA,
  BUILTIN_MACHINE_BACK,
  machineAspect,
  machineGeometry,
  machineVariant,
  machinePlacement,
  screenHeightPct,
  type ArcadeCamera,
  type ArcadeConfig,
  type ArcadeDeviceKey,
} from "@/data/arcadeConfig";
import { cameraVars, maxScrollScale } from "@/lib/arcadeCamera";
import { backdropBounds, isBackdropAsset, reachesBounds } from "@/lib/arcadeGuides";
import { AmbientWrap, DrawnAssetLayer } from "./DrawnSection";
import AssetImage from "./AssetImage";

export interface ArcadeSceneProps {
  arcade: ArcadeConfig;
  world: { w: number; h: number };
  assets: DrawnAsset[];
  language: "en" | "ar";
  /** Landing mode (scroll / transitioning-in / play / transitioning-out). */
  mode?: string;
  stageRef?: React.Ref<HTMLDivElement>;
  worldRef?: React.Ref<HTMLDivElement>;
  screenRef?: React.Ref<HTMLDivElement>;
  /** Contents of the game screen (the live game, or an editor placeholder). */
  screen: React.ReactNode;
  /** The click-to-play control over the screen (public only). */
  cta?: React.ReactNode;
  /** Click anywhere on the machine (public scroll mode → play). */
  onMachineClick?: (e: React.MouseEvent) => void;
  /** Editor: static camera, editing overlays inside the world. */
  editor?: {
    overlay?: React.ReactNode;
    /** Camera to show; default = identity (the whole world). */
    camera?: ArcadeCamera | null;
    /** Preview through a device frame of this aspect (clipped); default =
     *  the world's own aspect, unclipped (the whole drawing). */
    frameAspect?: number;
  };
}

/** Largest camera scale the world can be seen at — scroll keyframes, plus a
 *  generous allowance for the click-in (feeds image `sizes`). */
function zoomBudget(a: ArcadeConfig): number {
  return Math.min(
    4,
    Math.max(maxScrollScale(a.desktop), maxScrollScale(a.mobile), 1) * 1.5
  );
}

/** Share of the screen rect an asset's box covers (0–1), on one device. */
function screenCoverage(
  asset: DrawnAsset,
  arcade: ArcadeConfig,
  device: ArcadeDeviceKey,
  world: { w: number; h: number }
): number {
  const g = machineGeometry(arcade, device, world);
  const sw = (g.screenUnits.w / world.w) * 100;
  const sh = (g.screenUnits.h / world.h) * 100;
  const s = { l: g.screenCentre.x - sw / 2, t: g.screenCentre.y - sh / 2 };
  const m = device === "mobile" ? asset.mobile ?? {} : {};
  const ax = m.x ?? asset.x;
  const ay = m.y ?? asset.y;
  const aw = m.w ?? asset.w;
  const ah = m.h ?? asset.h;
  const ox = Math.max(0, Math.min(ax + aw, s.l + sw) - Math.max(ax, s.l));
  const oy = Math.max(0, Math.min(ay + ah, s.t + sh) - Math.max(ay, s.t));
  return (ox / sw) * (oy / sh);
}

export default function ArcadeScene({
  arcade,
  world,
  assets,
  language,
  mode = "scroll",
  stageRef,
  worldRef,
  screenRef,
  screen,
  cta,
  onMachineClick,
  editor,
}: ArcadeSceneProps) {
  const worldAspect = world.w / world.h;
  const d = arcade.desktop;
  const mo = arcade.mobile;
  const fa = (dev: typeof d) => dev.frame.aspect.w / dev.frame.aspect.h;

  // Frame + rest camera per device; CSS swaps -d / -m (globals.css). The
  // editor shows the whole world (identity) unless it previews a camera.
  const editorFrame = editor?.frameAspect ?? worldAspect;
  const stageVars = editor
    ? ({
        "--frame-a-d": editorFrame,
        "--frame-a-m": editorFrame,
        "--frame-fill-d": "transparent",
        "--frame-fill-m": "transparent",
      } as React.CSSProperties)
    : ({
        "--frame-a-d": fa(d),
        "--frame-a-m": fa(mo),
        "--frame-fill-d": d.frame.fill,
        "--frame-fill-m": mo.frame.fill,
        "--rest-s-d": d.rest.scale,
        "--rest-x-d": d.rest.focusX,
        "--rest-y-d": d.rest.focusY,
        "--rest-r-d": d.rest.rotation,
        "--rest-s-m": mo.rest.scale,
        "--rest-x-m": mo.rest.focusX,
        "--rest-y-m": mo.rest.focusY,
        "--rest-r-m": mo.rest.rotation,
      } as React.CSSProperties);

  const worldStyle = {
    // The phone play-mode dim layer sits just under the machine.
    "--machine-z": arcade.machine.zIndex,
    ...(editor
      ? cameraVars(editor.camera ?? { scale: 1, focusX: 50, focusY: 50, rotation: 0 })
      : {}),
  } as React.CSSProperties;

  // Foreground guard: props IN FRONT of the machine that cover more than the
  // threshold of the screen fade out while playing (per device), as does any
  // prop flagged "fade while playing".
  const guard = arcade.guards;
  // Soft edges: a backdrop that doesn't reach past the furthest camera view
  // fades at its own edges, so zoomed-out views never end in a hard cut.
  const farBounds = arcade.softEdges && !editor ? backdropBounds(arcade, world) : null;
  const assetAttrs = (asset: DrawnAsset): Record<string, string | undefined> => {
    const front = asset.zIndex > arcade.machine.zIndex;
    const limit = guard.foregroundFadePct / 100;
    const fadeD =
      asset.fadeInPlay ||
      (guard.foregroundFade && front && screenCoverage(asset, arcade, "desktop", world) > limit);
    const fadeM =
      asset.fadeInPlay ||
      (guard.foregroundFade && front && screenCoverage(asset, arcade, "mobile", world) > limit);
    return {
      "data-fade-play-d": fadeD ? "true" : undefined,
      "data-fade-play-m": fadeM ? "true" : undefined,
      "data-edge-fade":
        farBounds && isBackdropAsset(asset, arcade.machine.zIndex) && !reachesBounds(asset, farBounds)
          ? "true"
          : undefined,
    };
  };

  const zoom = zoomBudget(arcade);

  return (
    <div
      ref={stageRef}
      className={
        editor
          ? `arcade-stage arcade-stage--editor${editor.frameAspect ? " arcade-stage--preview" : ""}`
          : "arcade-stage"
      }
      data-mode={mode}
      data-soft-edges={!editor && arcade.softEdges ? "true" : undefined}
      style={stageVars}
    >
      <DrawnAssetLayer
        assets={assets}
        aspectRatio={world}
        language={language}
        mode="arcade"
        arcade={{
          boxRef: worldRef,
          boxStyle: worldStyle,
          boxAttrs: { "data-editor": editor ? "true" : undefined },
          zoom,
          assetAttrs,
        }}
        reference={
          <ArcadeMachine
            arcade={arcade}
            language={language}
            screenRef={screenRef}
            screen={screen}
            cta={cta}
            onClick={onMachineClick}
            zoom={zoom}
          />
        }
        editorOverlay={editor?.overlay}
      />
    </div>
  );
}

/** The machine group: back art → screen → CTA → front art, one transform. */
function ArcadeMachine({
  arcade,
  language,
  screenRef,
  screen,
  cta,
  onClick,
  zoom,
}: {
  arcade: ArcadeConfig;
  language: "en" | "ar";
  screenRef?: React.Ref<HTMLDivElement>;
  screen: React.ReactNode;
  cta?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  zoom: number;
}) {
  const m = arcade.machine;
  const vd = machineVariant(arcade, "desktop");
  const vm = machineVariant(arcade, "mobile");
  const hasPhoneArt = Boolean(m.phoneArt);
  const pd = machinePlacement(arcade, "desktop");
  const pm = machinePlacement(arcade, "mobile");
  const vars = {
    "--m-x-d": `${pd.x}%`,
    "--m-y-d": `${pd.y}%`,
    "--m-w-d": `${pd.w}%`,
    "--m-r-d": `${pd.rotation}deg`,
    "--m-x-m": `${pm.x}%`,
    "--m-y-m": `${pm.y}%`,
    "--m-w-m": `${pm.w}%`,
    "--m-r-m": `${pm.rotation}deg`,
    // Shape + screen rect per device (phones may have their own drawing);
    // CSS picks -d / -m with the arcade's device rule.
    "--m-a-d": machineAspect(arcade, "desktop"),
    "--m-a-m": machineAspect(arcade, "mobile"),
    "--screen-left-d": `${vd.screen.x}%`,
    "--screen-top-d": `${vd.screen.y}%`,
    "--screen-w-d": `${vd.screen.w}%`,
    "--screen-h-d": `${screenHeightPct(arcade, "desktop")}%`,
    "--screen-left-m": `${vm.screen.x}%`,
    "--screen-top-m": `${vm.screen.y}%`,
    "--screen-w-m": `${vm.screen.w}%`,
    "--screen-h-m": `${screenHeightPct(arcade, "mobile")}%`,
    zIndex: m.zIndex,
  } as React.CSSProperties;

  // Rendered width hint: machine width × zoom budget (vw of the world).
  const sizes = `${Math.ceil(Math.max(pd.w, pm.w) * zoom)}vw`;
  const ctaSrc = arcade.cta[language]?.url ?? BUILTIN_CTA[language];
  // One set of layers per drawing; with phone art, both are rendered and the
  // device rule shows one (data-variant d / m).
  const variants: { key: "both" | "d" | "m"; v: typeof vd }[] = hasPhoneArt
    ? [
        { key: "d", v: vd },
        { key: "m", v: vm },
      ]
    : [{ key: "both", v: vd }];
  const backs = variants.map(({ key, v }) => (
    <div
      key={`back-${key}`}
      className="arcade-machine__layer arcade-machine__back"
      data-variant={key}
      data-shadow={m.shadow ? "true" : undefined}
    >
      <AssetImage src={v.back?.url ?? BUILTIN_MACHINE_BACK} sizes={sizes} priority />
    </div>
  ));
  const fronts = variants.map(({ key, v }) =>
    v.front ? (
      <div key={`front-${key}`} className="arcade-machine__layer arcade-machine__front" data-variant={key}>
        <AssetImage src={v.front.url} sizes={sizes} priority />
      </div>
    ) : null
  );

  const body = (
    <div className="arcade-machine__body">
      {backs}
      <div ref={screenRef} className="cabinet-stage__screen">
        {screen}
      </div>
      <div className="cabinet-stage__cta-wrap" data-pulse={arcade.cta.pulse ? "true" : undefined}>
        {/* The CTA art is presentational; the `cta` button is the control. */}
        <div className="arcade-machine__cta-art" aria-hidden="true">
          <AssetImage src={ctaSrc} sizes={sizes} />
        </div>
        {cta}
      </div>
      {fronts}
    </div>
  );

  return (
    <div
      className="arcade-machine"
      data-hover={m.hover}
      style={vars}
      onClick={onClick}
      data-arcade-machine=""
    >
      {m.ambient ? <AmbientWrap preset={m.ambient}>{body}</AmbientWrap> : body}
    </div>
  );
}
