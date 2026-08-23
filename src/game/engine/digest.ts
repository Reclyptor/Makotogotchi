// What the scene draws, hashed instead of drawn (SPEC §10.1).
//
// The room repaints on a 15fps cadence, but most of those paints put down
// pixels identical to the frame before: measured on the live build, only ~4
// frames a second differ under normal motion and ~0.1 under reduced motion.
// Every identical paint still costs a texture upload and forces all nineteen
// `backdrop-filter` panels above it to re-blur, so the cheapest frame is the
// one that never reaches the canvas.
//
// Knowing whether a frame differs means knowing what it would draw, which is
// why this is a recording stand-in for the context rather than a predicate
// over scene state. `Room.paint` runs twice — once against `DigestContext`,
// which only folds the calls into a hash, and again against the real context
// only if that hash moved. There is no second implementation to keep in step
// with the first, so the digest cannot drift from the drawing: it *is* the
// drawing, with the canvas taken away.
//
// The bias is deliberate. A call that changes nothing visible (a fillStyle
// assigned and then overwritten) still moves the hash and costs one needless
// repaint. A visible change that failed to move the hash would be a frozen
// scene, so everything that can reach a pixel — the effective transform,
// alpha, fill, font and clip in force at the moment of the call — is folded
// in at the point of the draw.

/**
 * The slice of `CanvasRenderingContext2D` the scene actually uses.
 * `CanvasRenderingContext2D` satisfies it structurally, so the real context
 * is passed unchanged; declaring it is what lets a non-canvas stand-in be
 * passed too, without a cast.
 */
export type SceneContext = {
  imageSmoothingEnabled: boolean;
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  createImageData(sw: number, sh: number): ImageData;
  putImageData(imagedata: ImageData, dx: number, dy: number): void;
};

/** The 2D affine matrix, in the order the canvas API names it. */
type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 16777619;

export class DigestContext implements SceneContext {
  private hash = FNV_OFFSET;
  private matrix: Matrix = { ...IDENTITY };
  private stack: { matrix: Matrix; alpha: number; fill: string; font: string; align: CanvasTextAlign }[] = [];

  imageSmoothingEnabled = true;
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  font = "";
  textAlign: CanvasTextAlign = "start";

  /** Start a fresh frame. */
  reset(): void {
    this.hash = FNV_OFFSET;
    this.matrix = { ...IDENTITY };
    this.stack.length = 0;
    this.globalAlpha = 1;
    this.fillStyle = "#000";
    this.font = "";
    this.textAlign = "start";
  }

  get value(): number {
    return this.hash >>> 0;
  }

  private fold(value: number): void {
    this.hash = Math.imul(this.hash ^ (value | 0), FNV_PRIME);
  }

  /**
   * Fold in something the draw calls cannot describe. The architecture blit
   * hands the canvas a cached image; the calls that place it are identical
   * whatever it contains, so the key identifying those pixels goes in here.
   */
  text(value: string): void {
    for (let index = 0; index < value.length; index++) this.fold(value.charCodeAt(index));
    this.fold(value.length);
  }

  /** Numbers reach the hash as fixed-point, so sub-pixel motion still counts. */
  private num(value: number): void {
    this.fold(Math.round(value * 256));
  }

  /** Everything in force at the moment of a draw, folded with the draw. */
  private paintState(): void {
    this.num(this.matrix.a);
    this.num(this.matrix.b);
    this.num(this.matrix.c);
    this.num(this.matrix.d);
    this.num(this.matrix.e);
    this.num(this.matrix.f);
    this.num(this.globalAlpha);
    this.text(typeof this.fillStyle === "string" ? this.fillStyle : "object-fill");
  }

  save(): void {
    this.fold(1);
    this.stack.push({
      matrix: { ...this.matrix },
      alpha: this.globalAlpha,
      fill: typeof this.fillStyle === "string" ? this.fillStyle : "object-fill",
      font: this.font,
      align: this.textAlign,
    });
  }

  restore(): void {
    this.fold(2);
    const previous = this.stack.pop();
    if (!previous) return;
    this.matrix = previous.matrix;
    this.globalAlpha = previous.alpha;
    this.fillStyle = previous.fill;
    this.font = previous.font;
    this.textAlign = previous.align;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = { a, b, c, d, e, f };
  }

  translate(x: number, y: number): void {
    this.matrix.e += this.matrix.a * x + this.matrix.c * y;
    this.matrix.f += this.matrix.b * x + this.matrix.d * y;
  }

  scale(x: number, y: number): void {
    this.matrix.a *= x;
    this.matrix.b *= x;
    this.matrix.c *= y;
    this.matrix.d *= y;
  }

  beginPath(): void {
    this.fold(3);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.fold(4);
    this.num(x);
    this.num(y);
    this.num(w);
    this.num(h);
  }

  clip(): void {
    // The path's own numbers are already folded in by rect(); a clip changes
    // what every later call can reach, so its position in the stream matters.
    this.fold(5);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fold(6);
    this.num(x);
    this.num(y);
    this.num(w);
    this.num(h);
    this.paintState();
  }

  fillText(text: string, x: number, y: number): void {
    this.fold(7);
    this.text(text);
    this.num(x);
    this.num(y);
    this.paintState();
    this.text(this.font);
    this.text(this.textAlign);
  }

  drawImage(image: CanvasImageSource, ...args: number[]): void {
    this.fold(8);
    // A source rectangle names the sprite frame uniquely, so the atlas needs
    // nothing else to be told apart. A three-argument blit carries no source
    // rectangle — that is the architecture cache, and its key is folded in by
    // the caller.
    this.fold(args.length);
    for (const value of args) this.num(value);
    this.paintState();
  }

  createImageData(sw: number, sh: number): ImageData {
    // A stand-in: the caller fills it and hands it straight back, and the
    // pixels themselves are identified by the cache key rather than hashed.
    return { data: new Uint8ClampedArray(sw * sh * 4), width: sw, height: sh, colorSpace: "srgb" } as ImageData;
  }

  putImageData(imagedata: ImageData, dx: number, dy: number): void {
    this.fold(9);
    this.num(imagedata.width);
    this.num(imagedata.height);
    this.num(dx);
    this.num(dy);
  }
}
