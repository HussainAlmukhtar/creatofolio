// Server-safe half of touchMode.ts (no "use client"), so the root layout can
// inline the pre-hydration script. See touchMode.ts for the model.

/** Primary pointer is a finger, or nothing can hover at all. A desktop with a
 *  touchscreen keeps a fine primary pointer and stays in desktop mode; an
 *  iPad with a trackpad still reports a coarse primary pointer. */
export const TOUCH_QUERY = "(pointer: coarse), (any-hover: none)";

export const OVERRIDE_KEY = "admin:touch-override";

/** `?touch=1` / `?touch=0` overrides are a development aid only. */
export const devOverrides = process.env.NODE_ENV !== "production";

/** Inline, pre-hydration version of `syncTouchAttribute`, so the first paint
 *  of an admin page is already in the right mode (no desktop→touch reflow).
 *  Admin paths only: the public site never gets `data-touch`. */
export const TOUCH_BOOT_SCRIPT = `(function(){try{if(location.pathname.indexOf("/admin")!==0)return;var f=null;${
  devOverrides
    ? `var q=new URLSearchParams(location.search).get("touch");if(q==="1"||q==="0")sessionStorage.setItem("${OVERRIDE_KEY}",q);var v=sessionStorage.getItem("${OVERRIDE_KEY}");f=v==="1"?true:v==="0"?false:null;`
    : ""
}var t=f!==null?f:matchMedia("${TOUCH_QUERY}").matches;if(t)document.documentElement.setAttribute("data-touch","")}catch(e){}})();`;
