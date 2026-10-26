// The platform's game shell has a strict CSP with no 'unsafe-eval' (ARCHITECTURE
// §5.5). Pixi refuses to start under it unless pixi.js/unsafe-eval is loaded
// first. `npm run harness` applies the same CSP; this catches the import being
// dropped without having to open a browser.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("platform CSP compatibility", () => {
  it('src/client/entry.ts imports "pixi.js/unsafe-eval" before anything else', () => {
    const source = readFileSync(
      new URL("../src/client/entry.ts", import.meta.url),
      "utf8",
    );
    const firstImport = source.match(/^import\s.*$/m)?.[0];
    expect(firstImport).toBe('import "pixi.js/unsafe-eval";');
  });
});
