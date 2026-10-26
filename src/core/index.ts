// Headless core entry: what the server validator vendors (npm run build:core).
import type { GameCoreModule } from "@arcadepro/game-sdk";
import { core, plausibility, type StubTapperState } from "./rules";

export type { StubTapperState };
export const coreModule: GameCoreModule<StubTapperState> = {
  core,
  plausibility,
};
export default coreModule;
