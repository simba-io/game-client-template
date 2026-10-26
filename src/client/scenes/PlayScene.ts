import * as PIXI from "pixi.js";
import coreModule, { isBonusTick, type StubTapperState } from "../../core";
import { GAME } from "../../game.config";
import { centredText } from "./text";

const { core } = coreModule;
const BAR = { x: 160, y: 600, width: 1600, height: 60 };
const TARGET = { x: GAME.designWidth / 2, y: 1750, radius: 560 };
const FLASH_MS = 300;
const PULSE_MS = 120;

/**
 * Stub Tapper play screen: score, time bar, a big tap target, a flash on bonus
 * ticks and a pulse on each tap. All of it is drawn from the core's state;
 * the flash and pulse are purely cosmetic.
 */
export class PlayScene extends PIXI.Container {
  private readonly score = centredText("0", 220, GAME.designWidth / 2, 350, {
    fontWeight: "bold",
  });
  private readonly timeFill = new PIXI.Graphics();
  private readonly target = new PIXI.Container();
  private readonly flash = new PIXI.Graphics()
    .rect(0, 0, GAME.designWidth, GAME.designHeight)
    .fill(0xffd700);
  private flashAt = -Infinity;
  private pulseAt = -Infinity;

  constructor() {
    super();
    this.flash.alpha = 0;
    const timeBack = new PIXI.Graphics()
      .rect(BAR.x, BAR.y, BAR.width, BAR.height)
      .fill({ color: 0x000000, alpha: 0.25 });
    this.target.position.set(TARGET.x, TARGET.y);
    this.target.addChild(
      new PIXI.Graphics()
        .circle(0, 0, TARGET.radius)
        .fill(0xffffff)
        .stroke({ width: 24, color: 0x0b6e8a }),
      centredText("TAP", 200, 0, 0, { fill: 0x0b6e8a, fontWeight: "bold" }),
    );
    this.addChild(this.flash, this.score, timeBack, this.timeFill, this.target);
  }

  reset(): void {
    this.flashAt = -Infinity;
    this.pulseAt = -Infinity;
    this.render(null);
  }

  /** Cosmetic feedback for a recorded tap. */
  pulse(): void {
    this.pulseAt = performance.now();
  }

  render(state: StubTapperState | null): void {
    const now = performance.now();
    const score = state ? String(core.score(state)) : "0";
    if (this.score.text !== score) this.score.text = score;

    const remaining = state ? 1 - state.tick / core.maxTicks : 1;
    this.timeFill
      .clear()
      .rect(BAR.x, BAR.y, BAR.width * Math.max(0, remaining), BAR.height)
      .fill(0xffffff);

    if (state && isBonusTick(state)) this.flashAt = now;
    this.flash.alpha = 0.5 * Math.max(0, 1 - (now - this.flashAt) / FLASH_MS);
    this.target.scale.set(
      1 + 0.06 * Math.max(0, 1 - (now - this.pulseAt) / PULSE_MS),
    );
  }
}
