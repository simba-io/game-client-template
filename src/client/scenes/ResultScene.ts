import * as PIXI from "pixi.js";
import type { RunVerdict } from "@arcadepro/game-sdk";
import { GAME } from "../../game.config";
import { centredText } from "./text";

/**
 * Final score and the server's verdict. In standalone mode a "Play again"
 * button appears once the verdict is in.
 */
export class ResultScene extends PIXI.Container {
  private readonly score: PIXI.Text;
  private readonly verdict: PIXI.Text;
  private readonly playAgain: PIXI.Container;

  constructor(standalone: boolean, onPlayAgain: () => void) {
    super();
    const cx = GAME.designWidth / 2;
    this.addChild(
      centredText("Time's up!", 160, cx, 700, { fontWeight: "bold" }),
    );
    this.score = this.addChild(
      centredText("", 320, cx, 1150, { fontWeight: "bold" }),
    );
    this.verdict = this.addChild(centredText("", 100, cx, 1650));

    this.playAgain = new PIXI.Container();
    this.playAgain.position.set(cx, 2300);
    this.playAgain.addChild(
      new PIXI.Graphics().roundRect(-450, -130, 900, 260, 60).fill(0xffffff),
      centredText("Play again", 110, 0, 0, {
        fill: 0x0b6e8a,
        fontWeight: "bold",
      }),
    );
    this.playAgain.eventMode = "static";
    this.playAgain.cursor = "pointer";
    this.playAgain.on("pointertap", onPlayAgain);
    this.playAgain.visible = false;
    if (standalone) this.addChild(this.playAgain);
  }

  showVerifying(clientScore: number): void {
    this.score.text = String(clientScore);
    this.verdict.text = "Verifying…";
    this.playAgain.visible = false;
  }

  showVerdict(v: RunVerdict): void {
    if (v.status === "verified") {
      this.score.text = String(v.score);
      this.verdict.text = v.isPersonalBest
        ? "Verified ✓\nNew personal best!"
        : "Verified ✓";
    } else if (v.status === "flagged") {
      this.score.text = String(v.score);
      this.verdict.text = `Held for review\n(${v.reasons.join(", ")})`;
    } else {
      this.verdict.text = `Run rejected\n(${v.reason})`;
    }
    this.playAgain.visible = true;
  }

  /** Static scene: nothing to draw from the run state. */
  render(): void {}
}
