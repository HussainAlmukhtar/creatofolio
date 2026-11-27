"use client";

// TipTapView — read-only rendering of a TipTap JSON document (pop-up rich
// text). Walks the JSON into React elements (no HTML strings), and every link
// href / image src goes through safeUrl: an unsafe link renders as plain text,
// an unsafe image renders nothing ("refuse quietly").

import type { ReactNode } from "react";
import type { TipTapDoc, TipTapNode } from "@/data/contentTypes";
import { isExternalHref, safeHref, safeMediaSrc } from "@/lib/safeUrl";

export function TipTapView({ doc }: { doc?: TipTapDoc }) {
  if (!doc?.content?.length) return null;
  return (
    <div className="popup-prose">
      {doc.content.map((node, i) => (
        <NodeView key={i} node={node} />
      ))}
    </div>
  );
}

function NodeView({ node }: { node: TipTapNode }): ReactNode {
  if (node.type === "text") {
    let out: ReactNode = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") out = <strong>{out}</strong>;
      else if (mark.type === "italic") out = <em>{out}</em>;
      else if (mark.type === "underline") out = <u>{out}</u>;
      else if (mark.type === "strike") out = <s>{out}</s>;
      else if (mark.type === "code") out = <code>{out}</code>;
      else if (mark.type === "link") {
        const href = safeHref(mark.attrs?.href);
        if (href) {
          const ext = isExternalHref(href);
          out = (
            <a href={href} {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {out}
            </a>
          );
        }
      }
    }
    return <>{out}</>;
  }

  const children = node.content?.map((child, i) => <NodeView key={i} node={child} />);

  switch (node.type) {
    case "paragraph":
      return <p>{children}</p>;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 2), 4);
      const Tag = `h${level + 1}` as "h3" | "h4" | "h5";
      return <Tag>{children}</Tag>;
    }
    case "bulletList":
      return <ul>{children}</ul>;
    case "orderedList":
      return <ol>{children}</ol>;
    case "listItem":
      return <li>{children}</li>;
    case "blockquote":
      return <blockquote>{children}</blockquote>;
    case "codeBlock":
      return (
        <pre>
          <code>{children}</code>
        </pre>
      );
    case "image": {
      const src = safeMediaSrc(node.attrs?.src, "image");
      if (!src) return null;
      // eslint-disable-next-line @next/next/no-img-element -- owner content, any host
      return <img src={src} alt={String(node.attrs?.alt ?? "")} loading="lazy" />;
    }
    case "hardBreak":
      return <br />;
    case "horizontalRule":
      return <hr />;
    default:
      return <div>{children}</div>;
  }
}
