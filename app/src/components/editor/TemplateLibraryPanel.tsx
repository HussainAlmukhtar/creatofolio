"use client";

// TemplateLibraryPanel — browses object templates with category filter +
// free-text search + tag chip search. Drag a template card onto the canvas
// to spawn a fully-formed RoomObject (handler in EditorCanvas).
//
// Mounted as a tab inside AssetLibraryPanel; never used standalone.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2, Search } from "lucide-react";
import {
  listTemplates,
  deleteTemplate,
  TEMPLATE_CATEGORIES,
  type TemplateRow,
  type TemplateCategory,
} from "@/lib/editorData";
import {
  categoryEmoji,
  categoryHex,
  categoryLabel,
} from "@/lib/templateCategories";
import { Tooltip } from "@/components/editor/EditorTooltip";

export function TemplateLibraryPanel() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<
    TemplateCategory | "all"
  >("all");
  const [search, setSearch] = useState("");
  // Multi-select tag chips. AND-intersected with
  // search + category. Set so toggling a chip is O(1) and React re-renders
  // cheaply on identity change. Empty set = "no tag filter".
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listTemplates();
      setTemplates(list);
    } catch (err) {
      toast.error("Failed to load templates", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh on the cross-component event the SaveAsTemplateModal fires.
  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener("editor:templates-changed", onChange);
    return () =>
      window.removeEventListener("editor:templates-changed", onChange);
  }, [refresh]);

  // Client-side filter so the user's keystrokes don't hit the network on
  // every change. The list is small enough (tens to a few hundred) that
  // filtering in the browser is plenty fast.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (activeCategory !== "all" && t.category !== activeCategory) {
        return false;
      }
      // All selected tag chips must be present on the template (AND, not OR)
      // — clicking "door" + "wood" should narrow to templates carrying both.
      if (selectedTags.size > 0) {
        for (const wanted of selectedTags) {
          if (!t.tags.includes(wanted)) return false;
        }
      }
      if (!needle) return true;
      if (t.name.toLowerCase().includes(needle)) return true;
      if (t.nameAr?.toLowerCase().includes(needle)) return true;
      if (t.tags.some((tag) => tag.toLowerCase().includes(needle))) {
        return true;
      }
      return false;
    });
  }, [templates, activeCategory, search, selectedTags]);

  // Distinct tags + counts for the chip row. Counts ignore the search box
  // and tag selection so they always reflect "how many templates carry this
  // tag (within the active category)" — chip counts that mutate with each
  // click feel chaotic.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates) {
      if (activeCategory !== "all" && t.category !== activeCategory) continue;
      for (const tag of t.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) =>
      b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])
    );
  }, [templates, activeCategory]);

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    tpl: TemplateRow
  ) => {
    // EditorCanvas's drop handler reads this MIME type. The whole
    // serialized template flies along the drag so the drop site doesn't
    // need to refetch.
    e.dataTransfer.setData(
      "application/x-editor-template",
      JSON.stringify(tpl)
    );
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDelete = async (tpl: TemplateRow) => {
    const note =
      tpl.usageCount > 0
        ? ` Used by ${tpl.usageCount} room${tpl.usageCount === 1 ? "" : "s"}. Existing placed objects keep their sprite but lose the template.`
        : "";
    if (!confirm(`Delete template "${tpl.name}"?${note}`)) return;
    const result = await deleteTemplate(tpl.id);
    if (result.ok) {
      toast.success(`Deleted "${tpl.name}"`);
      refresh();
    } else {
      toast.error("Failed to delete", { description: result.error });
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-2 space-y-2 border-b border-neutral-700">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="w-full pl-7 pr-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-xs text-neutral-200 placeholder:text-neutral-500"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          <CategoryChip
            label="All"
            active={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
          />
          {TEMPLATE_CATEGORIES.map((c) => (
            <CategoryChip
              key={c}
              label={`${categoryEmoji(c)} ${categoryLabel(c)}`}
              hex={categoryHex(c)}
              active={activeCategory === c}
              onClick={() => setActiveCategory(c)}
            />
          ))}
        </div>

        {tagCounts.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tagCounts.map(([tag, count]) => {
              const active = selectedTags.has(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    active
                      ? "bg-blue-500 border-blue-500 text-white"
                      : "bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700"
                  }`}
                  title={`${count} template${count === 1 ? "" : "s"} tagged "${tag}"`}
                >
                  #{tag}
                  <span
                    className={`ml-1 ${active ? "text-white/80" : "text-neutral-500"}`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
            {selectedTags.size > 0 && (
              <Tooltip label="Clear tag filters">
                <button
                  onClick={() => setSelectedTags(new Set())}
                  className="text-[10px] px-1.5 py-0.5 rounded border bg-neutral-900 border-neutral-700 text-neutral-400 hover:text-neutral-200"
                >
                  ×
                </button>
              </Tooltip>
            )}
          </div>
        )}

        <button
          onClick={refresh}
          className="w-full flex items-center justify-center gap-1.5 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700 rounded"
          aria-label="Refresh template list"
        >
          <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="text-xs text-neutral-500 text-center py-4">
            Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="text-xs text-neutral-500 text-center py-4 leading-relaxed px-2">
            {templates.length === 0
              ? "No templates yet. Tune an object's hitbox + interaction, then click \u201CSave as Template\u201D in the side panel."
              : "No templates match this filter."}
          </div>
        ) : (
          <div className="space-y-1.5">
            {visible.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                tpl={tpl}
                onDragStart={handleDragStart}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  hex,
  active,
  onClick,
}: {
  label: string;
  hex?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
        active
          ? "bg-neutral-100 text-neutral-900 border-neutral-100"
          : "bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700"
      }`}
      style={
        active && hex
          ? { backgroundColor: hex, borderColor: hex, color: "#fff" }
          : undefined
      }
    >
      {label}
    </button>
  );
}

function TemplateCard({
  tpl,
  onDragStart,
  onDelete,
}: {
  tpl: TemplateRow;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, tpl: TemplateRow) => void;
  onDelete: (tpl: TemplateRow) => void;
}) {
  const tint = categoryHex(tpl.category);
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, tpl)}
      className="group relative bg-neutral-900 border rounded p-2 cursor-grab active:cursor-grabbing hover:border-blue-500 transition-colors"
      style={{ borderColor: tint + "60" }}
      title={`${tpl.name} (${tpl.defaultWidth}×${tpl.defaultHeight})`}
    >
      <div className="flex gap-2 items-start">
        <div className="w-12 h-12 flex-shrink-0 bg-neutral-800 rounded border border-neutral-700 overflow-hidden flex items-center justify-center">
          {tpl.spriteUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tpl.spriteUrl}
              alt={tpl.name}
              className="w-full h-full object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="text-lg">{categoryEmoji(tpl.category)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-neutral-100 truncate">
            {tpl.name}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded text-white"
              style={{ backgroundColor: tint }}
            >
              {categoryLabel(tpl.category)}
            </span>
            {tpl.usageCount > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-300"
                title={`Used in ${tpl.usageCount} room${
                  tpl.usageCount === 1 ? "" : "s"
                }`}
              >
                ×{tpl.usageCount}
              </span>
            )}
          </div>
          {tpl.tags.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-1">
              {tpl.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] px-1 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700"
                >
                  {tag}
                </span>
              ))}
              {tpl.tags.length > 3 && (
                <span className="text-[9px] text-neutral-500">
                  +{tpl.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
        <Tooltip label="Delete template">
          <button
            onClick={() => onDelete(tpl)}
            className="opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity p-1 text-neutral-400 hover:text-red-400"
            aria-label={`Delete template ${tpl.name}`}
          >
            <Trash2 size={12} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
