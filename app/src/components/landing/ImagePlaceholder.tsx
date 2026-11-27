// The "image goes here" box — drawn in CSS so its dashed border and icon stay
// crisp and undistorted at any size or aspect (see isPlaceholderSrc).
//  - `fill`: covers its positioned parent (free-placed image elements).
//  - otherwise: an in-flow box with the given aspect ratio (blocks).

import { ImageIcon } from "lucide-react";

export default function ImagePlaceholder({
  fill,
  aspect = "4 / 3",
  className = "",
}: {
  fill?: boolean;
  aspect?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`image-placeholder ${fill ? "absolute inset-0" : "w-full"} ${className}`}
      style={fill ? undefined : { aspectRatio: aspect }}
    >
      <ImageIcon strokeWidth={1.5} />
    </div>
  );
}
