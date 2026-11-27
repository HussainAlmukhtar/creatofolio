"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, RefreshCw, X } from "lucide-react";
import {
  listSprites,
  uploadLibrarySprite,
  type SpriteAsset,
} from "@/lib/editorData";
import { useEditorStore } from "@/stores/editorStore";
import { TemplateLibraryPanel } from "./TemplateLibraryPanel";
import { Tooltip } from "@/components/editor/EditorTooltip";

type AssetTab = "templates" | "sprites";

export function AssetLibraryPanel() {
  const [tab, setTab] = useState<AssetTab>("templates");
  const toggleAssetLibrary = useEditorStore((s) => s.toggleAssetLibrary);

  // AddMenu's "From Library…" row dispatches this when the panel is already
  // open, so we snap back to the Templates tab regardless of what the user
  // had selected.
  useEffect(() => {
    const onFocus = () => setTab("templates");
    window.addEventListener("editor:focus-templates-tab", onFocus);
    return () =>
      window.removeEventListener("editor:focus-templates-tab", onFocus);
  }, []);

  return (
    <aside className="w-60 bg-neutral-800 border-r border-neutral-700 flex flex-col overflow-hidden flex-shrink-0">
      <header className="flex items-center justify-between px-3 py-2 border-b border-neutral-700">
        <h2 className="text-sm font-medium">Library</h2>
        <Tooltip label="Close library" shortcut="L">
          <button
            onClick={toggleAssetLibrary}
            className="p-1 rounded hover:bg-neutral-700 text-neutral-300"
            aria-label="Close asset library"
          >
            <X size={14} />
          </button>
        </Tooltip>
      </header>

      {/* Templates are listed first because they're the high-leverage path:
          drop a fully-formed door rather than a raw image you then re-tune. */}
      <div className="flex border-b border-neutral-700 text-xs">
        <button
          onClick={() => setTab("templates")}
          className={`flex-1 py-1.5 transition-colors ${
            tab === "templates"
              ? "bg-neutral-900 text-white border-b border-blue-500"
              : "text-neutral-400 hover:bg-neutral-700"
          }`}
        >
          Templates
        </button>
        <button
          onClick={() => setTab("sprites")}
          className={`flex-1 py-1.5 transition-colors ${
            tab === "sprites"
              ? "bg-neutral-900 text-white border-b border-blue-500"
              : "text-neutral-400 hover:bg-neutral-700"
          }`}
        >
          Sprites
        </button>
      </div>

      {tab === "templates" ? <TemplateLibraryPanel /> : <SpriteListPanel />}
    </aside>
  );
}

function SpriteListPanel() {
  const [assets, setAssets] = useState<SpriteAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listSprites();
      setAssets(list);
    } catch (err) {
      toast.error("Failed to load sprites", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener("editor:assets-changed", onChange);
    return () => window.removeEventListener("editor:assets-changed", onChange);
  }, [refresh]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        const result = await uploadLibrarySprite(file, file.name);
        if (!result.ok) {
          toast.error(`Failed to upload ${file.name}`, {
            description: result.error,
          });
        }
      }
      await refresh();
      toast.success(`Uploaded ${files.length} sprite${files.length > 1 ? "s" : ""}`);
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLImageElement>, asset: SpriteAsset) => {
    // Payload read by EditorCanvas's drop handler.
    e.dataTransfer.setData(
      "application/x-editor-sprite",
      JSON.stringify({ url: asset.url, name: asset.name })
    );
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-end px-2 py-1 border-b border-neutral-700">
        <Tooltip label="Refresh sprite list">
          <button
            onClick={refresh}
            className="p-1 rounded hover:bg-neutral-700 text-neutral-300"
            aria-label="Refresh asset list"
          >
            <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
          </button>
        </Tooltip>
      </div>

      <div className="p-2 border-b border-neutral-700">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 transition-colors"
        >
          <Upload size={14} />
          {isUploading ? "Uploading…" : "Upload sprites"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/webp,image/jpeg,image/gif"
          multiple
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="text-xs text-neutral-500 text-center py-4">
            Loading…
          </div>
        ) : assets.length === 0 ? (
          <div className="text-xs text-neutral-500 text-center py-4 leading-relaxed">
            No sprites yet. Upload PNGs and drag them onto the canvas.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {assets.map((asset) => (
              <div
                key={asset.path}
                className="group relative aspect-square bg-neutral-900 border border-neutral-700 rounded overflow-hidden hover:border-blue-500 transition-colors"
                title={asset.name}
              >
                <img
                  src={asset.url}
                  alt={asset.name}
                  draggable
                  onDragStart={(e) => handleDragStart(e, asset)}
                  className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
                  style={{ imageRendering: "pixelated" }}
                />
                <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-black/60 text-[10px] text-neutral-300 truncate opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity">
                  {asset.name}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
