import js from "@eslint/js";
import prettier from "eslint-plugin-prettier/recommended";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "dist-core"] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      prettier,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {},
  },
  // Core purity: the headless core runs in the browser AND on the server, and
  // must be deterministic (docs/ARCHITECTURE.md §7). Never disable these rules.
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@arcadepro/game-sdk/client",
              message: "Core must not use client helpers.",
            },
          ],
          patterns: [
            {
              group: [
                "pixi.js",
                "pixi.js/*",
                "simple-sound-editor",
                "../client/*",
                "../dev/*",
                "node:*",
              ],
              message:
                "Core must be headless and deterministic (see docs/ARCHITECTURE.md §7).",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "navigator",
        "performance",
        "Date",
        "fetch",
        "XMLHttpRequest",
        "localStorage",
        "sessionStorage",
        "setTimeout",
        "setInterval",
        "requestAnimationFrame",
        "crypto",
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Use createRng(config.seed).",
        },
        { object: "Math", property: "sin" },
        { object: "Math", property: "cos" },
        { object: "Math", property: "tan" },
        { object: "Math", property: "atan2" },
        { object: "Math", property: "pow" },
        { object: "Math", property: "exp" },
        { object: "Math", property: "log" },
      ],
    },
  },
);
