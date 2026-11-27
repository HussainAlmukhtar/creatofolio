// Landing-editor actions that pair a store change with feedback (toast +
// screen-reader announcement). Shared by the keyboard handler and the
// floating element toolbar.

import { toast } from "sonner";
import { useLandingEditorStore } from "@/stores/landingEditorStore";
import { announce } from "@/lib/a11yAnnounce";
import { ARCADE_MACHINE_IID } from "@/data/arcadeConfig";
import { lockMessage } from "@/lib/layerLock";

/** Remove an element and offer Undo (re-adds the exact element). */
export function removeAssetWithUndo(iid: string) {
  const st = useLandingEditorStore.getState();
  const page = st.currentPageSlug ? st.allPages[st.currentPageSlug]?.page : undefined;
  const section = page?.sections.find((s) => s.assets.some((a) => a.iid === iid));
  const asset = section?.assets.find((a) => a.iid === iid);
  st.removeAsset(iid);
  if (!section || !asset) return;
  announce("Element deleted. Press Control Z to undo.");
  toast("Element deleted", {
    duration: 6000,
    action: {
      label: "Undo",
      onClick: () => {
        const now = useLandingEditorStore.getState();
        const pg = now.currentPageSlug ? now.allPages[now.currentPageSlug]?.page : undefined;
        const sec = pg?.sections.find((s) => s.iid === section.iid);
        if (!sec) {
          toast.error("That section isn't open any more — use Ctrl+Z.");
          return;
        }
        if (sec.assets.some((a) => a.iid === iid)) return;
        now.addAsset(section.iid, asset);
        now.selectAsset(iid);
        announce("Element restored");
      },
    },
  });
}

/** Lock / Unlock an element (one undo step), announced for screen readers. */
export function toggleAssetLockWithFeedback(iid: string): boolean | null {
  const now = useLandingEditorStore.getState().toggleAssetLock(iid);
  if (now !== null) announce(lockMessage("Element", now));
  return now;
}

/** Lock / Unlock the Arcade machine (one undo step), announced. */
export function toggleMachineLockWithFeedback(sectionIid: string): boolean | null {
  const now = useLandingEditorStore.getState().toggleMachineLock(sectionIid);
  if (now !== null) announce(lockMessage("Arcade machine", now));
  return now;
}

/** Lock / Unlock whatever is selected: an element or the Arcade machine. */
export function toggleSelectionLock(): void {
  const st = useLandingEditorStore.getState();
  const iid = st.selectedAssetIid;
  if (!iid) return;
  if (iid === ARCADE_MACHINE_IID) {
    const page = st.currentPageSlug ? st.allPages[st.currentPageSlug]?.page : undefined;
    const sec = page?.sections.find((s) => s.containsGame);
    if (sec) toggleMachineLockWithFeedback(sec.iid);
    return;
  }
  toggleAssetLockWithFeedback(iid);
}
