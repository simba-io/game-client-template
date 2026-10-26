import { defineConfig } from "vite";

// `npm run build:core`: the headless core as ONE self-contained ES module,
// with the SDK bundled in and zero imports. The submit-run validator vendors
// this file, so it is left unminified for review.
export default defineConfig({
  build: {
    outDir: "dist-core",
    emptyOutDir: true,
    target: "es2022",
    minify: false,
    copyPublicDir: false, // dist-core/ must hold core.js only, no assets
    lib: {
      entry: "src/core/index.ts",
      formats: ["es"],
      fileName: () => "core.js",
    },
    rollupOptions: { external: [] },
  },
});
