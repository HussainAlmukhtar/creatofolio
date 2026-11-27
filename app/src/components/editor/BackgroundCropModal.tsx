"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
  Stage,
  Layer,
  Rect,
  Image as KonvaImage,
} from "react-konva";
import type { BgCrop } from "@/data/roomTypes";

interface BackgroundCropModalProps {
  originalUrl: string;
  roomWidth: number;
  roomHeight: number;
  existingCrop?: BgCrop;
  onApply: (croppedBlob: Blob, cropRegion: BgCrop) => void;
  onClose: () => void;
}

export default function BackgroundCropModal({
  originalUrl,
  roomWidth,
  roomHeight,
  existingCrop,
  onApply,
  onClose,
}: BackgroundCropModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitialized = useRef(false);

  const [originalImg, setOriginalImg] = useState<HTMLImageElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const [imgScale, setImgScale] = useState(1);
  const [imgPos, setImgPos] = useState({ x: 0, y: 0 });
  const [isApplying, setIsApplying] = useState(false);

  // Frame layout (centered in container with padding)
  const PAD = 60;
  const displayScale = Math.min(
    (containerSize.w - PAD * 2) / roomWidth,
    (containerSize.h - PAD * 2) / roomHeight
  );
  const frameW = roomWidth * displayScale;
  const frameH = roomHeight * displayScale;
  const frameX = (containerSize.w - frameW) / 2;
  const frameY = (containerSize.h - frameH) / 2;

  // Cover scale: image scaled so it covers the frame
  const coverScale =
    originalImg
      ? Math.max(
          frameW / originalImg.naturalWidth,
          frameH / originalImg.naturalHeight
        )
      : 1;

  // ─── Load original image ─────────────────────────────────
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setOriginalImg(img);
    img.src = originalUrl;
  }, [originalUrl]);

  // ─── Measure container ────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setContainerSize({
        w: entry.contentRect.width,
        h: entry.contentRect.height,
      });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ─── Initialize image position once ───────────────────────
  useEffect(() => {
    if (!originalImg || hasInitialized.current) return;
    if (frameW <= 0 || frameH <= 0) return;
    hasInitialized.current = true;

    if (existingCrop && existingCrop.width > 0) {
      const s = frameW / existingCrop.width;
      // One-time init once the async image and the measured frame both exist;
      // the user drags/zooms from here, so this can't be derived in render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setImgScale(s);
      setImgPos({
        x: frameX - existingCrop.x * s,
        y: frameY - existingCrop.y * s,
      });
    } else {
      const cs = Math.max(
        frameW / originalImg.naturalWidth,
        frameH / originalImg.naturalHeight
      );
      setImgScale(cs);
      setImgPos({
        x: frameX + (frameW - originalImg.naturalWidth * cs) / 2,
        y: frameY + (frameH - originalImg.naturalHeight * cs) / 2,
      });
    }
  }, [originalImg, frameW, frameH, frameX, frameY, existingCrop]);

  // ─── Zoom (scroll wheel, toward frame center) ────────────
  const handleWheel = useCallback(
    (e: { evt: WheelEvent }) => {
      e.evt.preventDefault();
      const factor = 1 - e.evt.deltaY * 0.001;
      const newScale = Math.max(coverScale * 0.1, Math.min(imgScale * factor, coverScale * 10));
      const cx = frameX + frameW / 2;
      const cy = frameY + frameH / 2;
      const ptX = (cx - imgPos.x) / imgScale;
      const ptY = (cy - imgPos.y) / imgScale;
      setImgScale(newScale);
      setImgPos({ x: cx - ptX * newScale, y: cy - ptY * newScale });
    },
    [imgScale, imgPos, frameX, frameY, frameW, frameH, coverScale]
  );

  // ─── Zoom slider ──────────────────────────────────────────
  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newScale = parseFloat(e.target.value) * coverScale;
      const cx = frameX + frameW / 2;
      const cy = frameY + frameH / 2;
      const ptX = (cx - imgPos.x) / imgScale;
      const ptY = (cy - imgPos.y) / imgScale;
      setImgScale(newScale);
      setImgPos({ x: cx - ptX * newScale, y: cy - ptY * newScale });
    },
    [imgScale, imgPos, frameX, frameY, frameW, frameH, coverScale]
  );

  // ─── Apply crop ───────────────────────────────────────────
  const handleApply = useCallback(async () => {
    if (!originalImg) return;
    setIsApplying(true);

    const cropX = (frameX - imgPos.x) / imgScale;
    const cropY = (frameY - imgPos.y) / imgScale;
    const cropW = frameW / imgScale;
    const cropH = frameH / imgScale;

    const canvas = document.createElement("canvas");
    canvas.width = roomWidth;
    canvas.height = roomHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(
      originalImg,
      cropX, cropY, cropW, cropH,
      0, 0, roomWidth, roomHeight
    );

    canvas.toBlob(
      (blob) => {
        if (blob) {
          onApply(blob, {
            x: cropX,
            y: cropY,
            width: cropW,
            height: cropH,
            originalWidth: originalImg.naturalWidth,
            originalHeight: originalImg.naturalHeight,
          });
        }
        setIsApplying(false);
      },
      "image/png"
    );
  }, [originalImg, imgScale, imgPos, frameX, frameY, frameW, frameH, roomWidth, roomHeight, onApply]);

  const handleDragEnd = useCallback((e: { target: { x: () => number; y: () => number } }) => {
    setImgPos({ x: e.target.x(), y: e.target.y() });
  }, []);

  // ─── Render ───────────────────────────────────────────────

  if (!originalImg) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
        <div className="text-white text-lg">Loading image...</div>
      </div>
    );
  }

  const zoomRatio = imgScale / coverScale;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 rounded-xl w-[90vw] h-[85dvh] flex flex-col shadow-2xl border border-neutral-700">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-700 flex-shrink-0">
          <h2 className="text-lg font-semibold text-white">
            Crop Background &mdash; {roomWidth}&times;{roomHeight}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleApply}
              disabled={isApplying}
              className="px-4 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {isApplying ? "Applying..." : "Apply Crop"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-neutral-700 text-neutral-300 text-sm hover:bg-neutral-600"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Canvas area */}
        <div ref={containerRef} className="flex-1 overflow-hidden bg-neutral-950">
          <Stage
            width={containerSize.w}
            height={containerSize.h}
            onWheel={handleWheel}
          >
            {/* Image layer */}
            <Layer>
              <KonvaImage
                image={originalImg}
                x={imgPos.x}
                y={imgPos.y}
                scaleX={imgScale}
                scaleY={imgScale}
                draggable
                onDragEnd={handleDragEnd}
              />
            </Layer>

            {/* Overlay layer */}
            <Layer listening={false}>
              {/* Dark rects around the crop frame */}
              <Rect x={0} y={0} width={containerSize.w} height={frameY} fill="black" opacity={0.6} />
              <Rect x={0} y={frameY + frameH} width={containerSize.w} height={Math.max(0, containerSize.h - frameY - frameH)} fill="black" opacity={0.6} />
              <Rect x={0} y={frameY} width={frameX} height={frameH} fill="black" opacity={0.6} />
              <Rect x={frameX + frameW} y={frameY} width={Math.max(0, containerSize.w - frameX - frameW)} height={frameH} fill="black" opacity={0.6} />

              {/* Frame border */}
              <Rect
                x={frameX}
                y={frameY}
                width={frameW}
                height={frameH}
                stroke="#ffffff"
                strokeWidth={2}
                dash={[8, 4]}
              />
            </Layer>
          </Stage>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-3 px-6 py-2 border-t border-neutral-700 flex-shrink-0">
          <span className="text-xs text-neutral-400">Zoom</span>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.01}
            value={zoomRatio}
            onChange={handleSlider}
            className="flex-1 accent-blue-500"
          />
          <span className="text-xs text-neutral-400 w-16 text-right">
            {(zoomRatio * 100).toFixed(0)}%
          </span>
          <span className="text-xs text-neutral-500">
            Scroll to zoom &middot; Drag to pan
          </span>
        </div>
      </div>
    </div>
  );
}
