import * as PIXI from "pixi.js";
import { GAME } from "../../game.config";
import { centredText } from "./text";

/** Logo, title and a status line (e.g. "Waiting for platform…"). */
export class TitleScene extends PIXI.Container {
  private readonly status: PIXI.Text;

  constructor(logo: PIXI.Texture) {
    super();
    const cx = GAME.designWidth / 2;
    const sprite = new PIXI.Sprite(logo);
    sprite.anchor.set(0.5);
    sprite.scale.set(1200 / sprite.texture.width);
    sprite.position.set(cx, 900);
    this.addChild(sprite);
    this.addChild(
      centredText(GAME.title, 180, cx, 1500, { fontWeight: "bold" }),
    );
    this.status = this.addChild(centredText("", 90, cx, 1800));
  }

  setStatus(text: string): void {
    this.status.text = text;
  }

  /** Static scene: nothing to draw from the run state. */
  render(): void {}
}
