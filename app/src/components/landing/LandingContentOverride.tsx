"use client";

// Draft-preview override for button pop-up content. The public site reads
// content from the live rows (loadPageContentPublic); the owner-only preview
// of a draft must show the DRAFT's content instead, so it provides this
// context. null (the default, and always on the public site) = read live.

import { createContext } from "react";
import type { ObjectContent } from "@/data/contentTypes";

/** { assetIid: ObjectContent } for the page being previewed. */
export const LandingContentOverrideContext = createContext<Record<string, ObjectContent> | null>(null);
