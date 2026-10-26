// The GameModule the platform shell imports from game.js.
//
// Keep this import first: the platform's game shell has a strict CSP with no
// 'unsafe-eval', and without it Pixi refuses to start ("Current environment
// does not allow unsafe-eval"). It swaps Pixi's generated-code paths for
// eval-free ones (part of pixi.js, not a new dependency).
import "pixi.js/unsafe-eval";
import type { GameModule } from "@arcadepro/game-sdk";
import { App } from "./App";

export const mount: GameModule["mount"] = async (container, ctx) => {
  const app = new App(container, ctx);
  await app.init();
  return { destroy: () => app.destroy() };
};

export default { mount } satisfies GameModule;
