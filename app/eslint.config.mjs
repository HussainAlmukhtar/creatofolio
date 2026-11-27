import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Rules that newer React hook presets added after most of this code was
    // written. They flag patterns that work today (setState in an effect
    // after a fetch, a ref read while rendering); they stay visible as
    // warnings so each can be revisited without blocking CI.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Klecks bundle (scripts/build-klecks.mjs output, gitignored
    // except the hand-written index.html wrapper) — vendored minified code,
    // not ours to lint. Without this `npm run lint` drowns in ~3.4k bundle
    // warnings and reports the bundle's own errors as ours.
    "public/klecks/**",
    "!public/klecks/index.html",
  ]),
]);

export default eslintConfig;
