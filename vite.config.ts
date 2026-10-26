import { defineConfig } from "vite";

// `npm run dev`: serves index.html (standalone dev host).
// `vite build`: library-mode platform build → dist/game.js + chunks/ + assets/.
// Library mode emits no index.html, which is correct: Supabase Storage serves
// .html as text/plain, so builds never contain an HTML page.
export default defineConfig(({ command }) => ({
  base: "./",
  server: { port: 8080, open: true },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build:
    command === "build"
      ? {
          outDir: "dist",
          emptyOutDir: true,
          target: "es2020",
          lib: {
            entry: "src/client/entry.ts",
            formats: ["es"],
            fileName: () => "game.js",
          },
          rollupOptions: {
            output: {
              chunkFileNames: "chunks/[name]-[hash].js",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
          copyPublicDir: true,
        }
      : undefined,
}));
