import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts, which becomes the library-mode game build.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
