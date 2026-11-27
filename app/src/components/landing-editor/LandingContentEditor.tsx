"use client";

// Landing counterpart of the room editor's <ContentEditor />: the pop-up
// builder for a button asset ("Edit content…" in the side panel). Hosts the
// shared PopupComposer: for a landing page `roomId` carries the page slug and
// `objectId` the asset iid, which is also how website_page_content / the
// version's content map are keyed. The preview uses the theme of the section
// the button sits in (paper vs digital), like the live pop-up.
//
// Closes itself if the asset it was opened for can't be found, because the
// editor's keyboard shortcuts are switched off while editingContentAssetIid
// is set.

import { useEffect, useMemo, useState } from "react";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import { useLandingEditorStore } from "@/stores/landingEditorStore";
import { PopupComposer } from "@/components/popup-editor/PopupComposer";
import { themeForSurface } from "@/components/landing/LandingActionProvider";

export function LandingContentEditor() {
  const assetIid = useLandingEditorStore((s) => s.editingContentAssetIid);
  const slug = useLandingEditorStore((s) => s.currentPageSlug);
  // Two selectors returning store references (a fresh { asset, surface }
  // object per call would re-render forever under zustand v5).
  const section = useLandingEditorStore((s) => {
    const page = s.currentPageSlug ? s.allPages[s.currentPageSlug]?.page : undefined;
    if (!page || !s.editingContentAssetIid) return null;
    return page.sections.find((sec) => sec.assets.some((a) => a.iid === s.editingContentAssetIid)) ?? null;
  });
  const asset = section?.assets.find((a) => a.iid === assetIid) ?? null;
  const found = section && asset ? { asset, surface: section.surface } : null;
  const closeContentEditor = useLandingEditorStore((s) => s.closeContentEditor);

  const unresolved = !!assetIid && (!slug || !found);
  useEffect(() => {
    if (unresolved) closeContentEditor();
  }, [unresolved, closeContentEditor]);

  if (!assetIid || !slug || !found) return null;
  return (
    <LandingPopupComposer
      key={`${slug}:${assetIid}`}
      slug={slug}
      assetIid={assetIid}
      label={found.asset.label || found.asset.labelAr || "Button"}
      labelAr={found.asset.labelAr || ""}
      theme={themeForSurface(found.surface)}
    />
  );
}

function LandingPopupComposer({
  slug,
  assetIid,
  label,
  labelAr,
  theme,
}: {
  slug: string;
  assetIid: string;
  label: string;
  labelAr: string;
  theme: ReturnType<typeof themeForSurface>;
}) {
  // Taken once on open: the content and whether the page already had unsaved edits.
  const [snapshot] = useState(() => {
    const st = useLandingEditorStore.getState();
    return { content: st.contentMap[`${slug}:${assetIid}`] ?? null, dirty: st.isDirty };
  });
  const updateContent = useLandingEditorStore((s) => s.updateContent);
  const restoreContent = useLandingEditorStore((s) => s.restoreContent);
  const closeContentEditor = useLandingEditorStore((s) => s.closeContentEditor);
  const allPages = useLandingEditorStore((s) => s.allPages);
  // The editor's own (maybe unsaved) forms destination, so the preview says
  // truthfully whether visitors will see a contact form.
  const forms = useSiteConfigEditorStore((s) => s.config.forms);
  const pages = useMemo(
    () => Object.values(allPages).map((r) => ({ slug: r.page.slug, status: r.status })),
    [allPages]
  );

  return (
    <PopupComposer
      objectId={assetIid}
      roomId={slug}
      objectLabel={{ en: label, ar: labelAr }}
      initial={snapshot.content}
      theme={theme}
      pages={pages}
      host="page"
      forms={forms}
      onChange={(c) => updateContent(assetIid, c)}
      onRevert={() => restoreContent(assetIid, snapshot.content, snapshot.dirty)}
      onClose={closeContentEditor}
    />
  );
}
