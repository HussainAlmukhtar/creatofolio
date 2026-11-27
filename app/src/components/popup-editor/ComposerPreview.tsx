"use client";

// ComposerPreview — the visitor's pop-up, live: the same backdrop + PopupSheet
// + PopupView the game and landing page use, contained in a desktop area or a
// phone frame (data-device drives the bottom-card layout, so the phone sheet
// previews correctly on any screen). Click a block to select it; click the
// title bar for the pop-up settings.

import { useEffect, useRef } from "react";
import { PopupSheet, PopupEmpty } from "@/components/popup/PopupSheet";
import { PopupView } from "@/components/popup/PopupView";
import type { PopupTheme } from "@/components/popup/popupTheme";
import { resolveLook, usePopupStyles } from "@/components/popup/PopupLook";
import { usePopupComposerStore } from "@/stores/popupComposerStore";

export function ComposerPreview({ theme, onSelect }: { theme: PopupTheme; onSelect: (id: string) => void }) {
  const content = usePopupComposerStore((s) => s.content);
  const selected = usePopupComposerStore((s) => s.selected);
  const device = usePopupComposerStore((s) => s.device);
  const lang = usePopupComposerStore((s) => s.previewLang);
  const select = usePopupComposerStore((s) => s.select);
  const page = usePopupComposerStore((s) => s.page);
  const setPage = usePopupComposerStore((s) => s.setPage);
  const frameRef = useRef<HTMLDivElement>(null);
  // The look visitors get: the active theme + this pop-up's frame.
  const { styles } = usePopupStyles();

  // Keep the selected block in view when it's picked from the outline.
  useEffect(() => {
    if (!selected || selected === "settings") return;
    const el = frameRef.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(selected)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  if (!content) return null;
  const isAr = lang === "ar";
  const title = isAr ? content.titleAr || content.title : content.title || content.titleAr;
  const empty = content.layout === "pages" ? !(content.pages ?? []).length : !(content.blocks ?? []).length;

  return (
    <div className="composer-preview absolute inset-0 grid place-items-center overflow-auto p-4">
      <div
        ref={frameRef}
        className={`composer-frame relative overflow-hidden ${
          device === "phone" ? "composer-frame--phone" : "composer-frame--desktop"
        }`}
        data-touch-exempt=""
      >
        <div className="popup-backdrop popup-backdrop--preview" data-device={device} dir={isAr ? "rtl" : "ltr"}>
          <PopupSheet
            title={title}
            language={lang}
            theme={theme}
            size={content.size ?? "m"}
            device={device}
            look={resolveLook(styles, content.frameIid)}
            dialogProps={{
              "aria-label": "Pop-up preview",
              onClickCapture: (e) => {
                // The title bar (and the inert close mark) open the settings.
                if ((e.target as HTMLElement).closest(".popup-sheet__drag")) {
                  e.preventDefault();
                  e.stopPropagation();
                  select("settings");
                }
              },
            }}
          >
            {empty ? (
              <PopupEmpty language={lang} />
            ) : (
              <PopupView
                content={content}
                language={lang}
                editor
                selectedId={selected}
                onSelect={onSelect}
                page={page}
                onPageChange={setPage}
              />
            )}
          </PopupSheet>
        </div>
      </div>
    </div>
  );
}
