"use client";

// RichTextField — bilingual rich text for the generated inspector
// (FieldDescriptor kind "richtext"; value `{ en?: TipTapDoc, ar?: TipTapDoc }`).
//
// Wide panels show English and Arabic side by side; narrow ones show EN / AR
// tabs, each with a dot that says whether that side has text. Links come from
// an inline form (validated with safeUrl, no window.prompt) and images from the
// media library. Loaded lazily by FormFields so TipTap stays out of bundles
// that never show a rich-text field.

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link2,
  ImagePlus,
  Undo2,
  Redo2,
} from "lucide-react";
import type { TipTapDoc } from "@/data/contentTypes";
import { docText } from "@/lib/localizedChecks";
import { safeHref, urlProblem } from "@/lib/safeUrl";
import { MediaLibraryDialog } from "@/components/landing-editor/MediaLibraryDialog";

type Value = { en?: TipTapDoc; ar?: TipTapDoc };
type Lang = "en" | "ar";

const EMPTY: TipTapDoc = { type: "doc", content: [{ type: "paragraph" }] };

export default function RichTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Value | undefined;
  onChange: (v: Value) => void;
}) {
  const v = value ?? {};
  const [tab, setTab] = useState<Lang>("en");
  const latest = useRef(v);
  useEffect(() => {
    latest.current = v;
  });
  const set = (lang: Lang, doc: TipTapDoc) => onChange({ ...latest.current, [lang]: doc });

  return (
    <div className="rt-field space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        {/* Tabs only matter when the panel is too narrow for two columns. */}
        <div className="rt-tabs inline-flex overflow-hidden rounded-md border border-border text-xs" role="tablist">
          {(["en", "ar"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={tab === l}
              onClick={() => setTab(l)}
              className={`flex items-center gap-1.5 px-2.5 py-1 ${tab === l ? "bg-accent text-foreground" : "text-muted-foreground"}`}
            >
              {l === "en" ? "English" : "العربية"}
              <span
                aria-label={docText(v[l]) ? "has text" : "empty"}
                className={`size-1.5 rounded-full ${docText(v[l]) ? "bg-emerald-400" : "bg-amber-400"}`}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="rt-cols">
        {(["en", "ar"] as const).map((l) => (
          <div key={l} className="rt-col" data-active={tab === l ? "" : undefined}>
            <span className="rt-col-label text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {l === "en" ? "English" : "العربية"}
            </span>
            <DocEditor lang={l} doc={v[l]} onChange={(d) => set(l, d)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DocEditor({ lang, doc, onChange }: { lang: Lang; doc?: TipTapDoc; onChange: (d: TipTapDoc) => void }) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const lastEmitted = useRef<string>("");
  // The doc prop follows every edit (write-through), so emptiness derives from it.
  const empty = !docText(doc) && !doc?.content?.some((n) => n.type === "image");

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        code: false,
        link: { openOnClick: false, autolink: true, isAllowedUri: (url) => !!safeHref(url) },
      }),
      Image,
    ],
    content: doc ?? EMPTY,
    editorProps: {
      attributes: {
        dir: lang === "ar" ? "rtl" : "ltr",
        lang,
        class: "rt-editor popup-prose",
        "aria-label": lang === "ar" ? "Arabic text" : "English text",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON() as TipTapDoc;
      lastEmitted.current = JSON.stringify(json);
      onChangeRef.current(json);
    },
  });

  // Outside changes (undo/redo in the composer, a revert) flow back in.
  useEffect(() => {
    if (!editor) return;
    const incoming = JSON.stringify(doc ?? EMPTY);
    if (incoming === lastEmitted.current) return;
    if (incoming === JSON.stringify(editor.getJSON())) return;
    editor.commands.setContent(doc ?? EMPTY, { emitUpdate: false });
  }, [doc, editor]);

  return (
    <div className="overflow-hidden rounded-md border border-input bg-background/40">
      {editor && <Toolbar editor={editor} />}
      <div className="relative">
        {empty && (
          <span aria-hidden="true" className="rt-placeholder" dir={lang === "ar" ? "rtl" : "ltr"}>
            {lang === "ar" ? "اكتب هنا…" : "Write here…"}
          </span>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [mediaOpen, setMediaOpen] = useState(false);
  // Re-render on selection/format changes so active states stay right.
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    editor.on("transaction", f);
    return () => {
      editor.off("transaction", f);
    };
  }, [editor]);

  const problem = urlProblem(linkUrl, "link");
  const applyLink = () => {
    const href = safeHref(linkUrl);
    if (!href) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  };

  return (
    <div className="border-b border-border">
      <div className="flex flex-wrap items-center gap-0.5 p-1">
        <ToolBtn label="Bold" active={editor.isActive("bold")} on={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Italic" active={editor.isActive("italic")} on={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Underline" active={editor.isActive("underline")} on={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="size-3.5" />
        </ToolBtn>
        <ToolBtn
          label="Heading"
          active={editor.isActive("heading", { level: 2 })}
          on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="size-3.5" />
        </ToolBtn>
        <ToolBtn
          label="Small heading"
          active={editor.isActive("heading", { level: 3 })}
          on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Bullet list" active={editor.isActive("bulletList")} on={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Numbered list" active={editor.isActive("orderedList")} on={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Quote" active={editor.isActive("blockquote")} on={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="size-3.5" />
        </ToolBtn>
        <ToolBtn
          label="Link"
          active={editor.isActive("link") || linkOpen}
          on={() => {
            setLinkUrl((editor.getAttributes("link").href as string) ?? "");
            setLinkOpen((o) => !o);
          }}
        >
          <Link2 className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Image" on={() => setMediaOpen(true)}>
          <ImagePlus className="size-3.5" />
        </ToolBtn>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <ToolBtn label="Undo" disabled={!editor.can().undo()} on={() => editor.chain().focus().undo().run()}>
          <Undo2 className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Redo" disabled={!editor.can().redo()} on={() => editor.chain().focus().redo().run()}>
          <Redo2 className="size-3.5" />
        </ToolBtn>
      </div>
      {linkOpen && (
        <div className="space-y-1 border-t border-border p-2">
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setLinkOpen(false);
                }
              }}
              placeholder="https://… , mailto:… or /page"
              aria-label="Link address"
              className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <button
              type="button"
              onClick={applyLink}
              disabled={!safeHref(linkUrl)}
              className="rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              Apply
            </button>
            {editor.isActive("link") && (
              <button
                type="button"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setLinkOpen(false);
                }}
                className="rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Remove
              </button>
            )}
          </div>
          {problem && <p className="text-[11px] text-red-400">{problem}</p>}
        </div>
      )}
      <MediaLibraryDialog
        open={mediaOpen}
        onOpenChange={setMediaOpen}
        uploadKind="content"
        onPick={({ url }) => editor.chain().focus().setImage({ src: url }).run()}
      />
    </div>
  );
}

function ToolBtn({
  on,
  label,
  active,
  disabled,
  children,
}: {
  on: () => void;
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor's selection while clicking the toolbar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      className={`grid size-7 place-items-center rounded touch:size-11 ${
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
