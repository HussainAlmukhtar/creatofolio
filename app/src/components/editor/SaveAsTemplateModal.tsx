"use client";

// SaveAsTemplateModal — captures the metadata needed to promote the
// currently-selected RoomObject into a reusable template. Pre-fills name
// + label from the object so the user just clicks Save in the common case.

import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useEditorStore } from "@/stores/editorStore";
import {
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
} from "@/lib/editorData";

interface Props {
  objectId: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function SaveAsTemplateModal({ objectId, onClose, onSaved }: Props) {
  const { currentRoomConfig, saveObjectAsTemplate } = useEditorStore();
  const obj = currentRoomConfig?.objects.find((o) => o.id === objectId);

  // Initial guesses: the object's label is usually a good template name; if
  // the object is a door we pre-pick the door category.
  const [name, setName] = useState(obj?.label ?? "");
  const [nameAr, setNameAr] = useState(obj?.labelAr ?? "");
  const [category, setCategory] = useState<TemplateCategory>(
    obj?.type === "door" ? "door" : "other"
  );
  const [tagsInput, setTagsInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (!obj) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Template needs a name");
      return;
    }
    if (!obj.spriteUrl) {
      toast.error("Object needs a sprite to be saved as a template", {
        description:
          "Draw or upload a sprite first — the template needs a thumbnail.",
      });
      return;
    }
    setIsSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const result = await saveObjectAsTemplate(objectId, {
        name: name.trim(),
        nameAr: nameAr.trim() || undefined,
        category,
        tags,
      });
      if (result.ok) {
        if (result.behaviourDropped) {
          toast.warning(`Template "${name.trim()}" saved without its steps`, {
            description: "Its “When clicked…” steps and hover need migration 20261008000002_popup_presets.sql (object_templates.behaviour).",
          });
        } else {
          toast.success(`Template "${name.trim()}" saved`, { description: "With its steps, walks-near and hover." });
        }
        // Tell the library panel to refresh.
        window.dispatchEvent(new Event("editor:templates-changed"));
        onSaved?.();
        onClose();
      } else {
        toast.error("Failed to save template", { description: result.error });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-xl p-5 w-full max-w-sm space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-100">
            Save as Template
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-neutral-700 text-neutral-300"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {obj.spriteUrl && (
          <div className="bg-neutral-800 rounded p-2 flex items-center justify-center border border-neutral-700">
            <img
              src={obj.spriteUrl}
              alt={obj.label}
              className="max-h-20"
              style={{ imageRendering: "pixelated" }}
            />
          </div>
        )}

        <label className="flex flex-col gap-1 text-xs text-neutral-300">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600"
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-neutral-300">
          Name (AR)
          <input
            type="text"
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-neutral-300">
          Category
          <select
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as TemplateCategory)
            }
            className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600"
          >
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-neutral-300">
          Tags (comma-separated)
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="indoor, wooden, modern"
            className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600"
          />
        </label>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-1.5 rounded text-xs bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="flex-1 py-1.5 rounded text-xs font-medium bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save Template"}
          </button>
        </div>
      </div>
    </div>
  );
}
