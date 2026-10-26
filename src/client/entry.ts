// The GameModule the platform shell imports from game.js.
import type { GameModule } from "@arcadepro/game-sdk";
import { App } from "./App";

export const mount: GameModule["mount"] = async (container, ctx) => {
  const app = new App(container, ctx);
  await app.init();
  return { destroy: () => app.destroy() };
};

export default { mount } satisfies GameModule;
