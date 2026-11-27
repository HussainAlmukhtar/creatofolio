import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Creatofolio",
    short_name: "Creatofolio",
    description: "An interactive, hand-drawn portfolio you can walk around in.",
    start_url: "/",
    display: "standalone",
    // Paper palette (globals.css --paper-1 / --ink).
    background_color: "#F8F5EE",
    theme_color: "#F8F5EE",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
