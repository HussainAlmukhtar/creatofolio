// Empty-state hint for a block that has nothing to show yet ("add slides in
// the settings panel"). Editor-only: on the public page an unfinished block
// renders nothing rather than instructions meant for the owner.

import type { ReactNode } from "react";

export function EditorHint({
  editor,
  children,
  className = "",
  style,
}: {
  editor?: boolean;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (!editor) return null;
  return (
    <div className={`editor-hint ${className}`} style={style}>
      {children}
    </div>
  );
}
