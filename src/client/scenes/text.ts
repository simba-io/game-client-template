import * as PIXI from "pixi.js";

/** A centred, white, word-wrapped label in design coordinates. */
export function centredText(
  text: string,
  fontSize: number,
  x: number,
  y: number,
  style: Partial<PIXI.TextStyleOptions> = {},
): PIXI.Text {
  const label = new PIXI.Text({
    text,
    style: {
      fill: 0xffffff,
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize,
      align: "center",
      wordWrap: true,
      wordWrapWidth: 1700,
      ...style,
    },
  });
  label.anchor.set(0.5);
  label.position.set(x, y);
  return label;
}
