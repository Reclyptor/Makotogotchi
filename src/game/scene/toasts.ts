// Floating attributed action toasts (SPEC §2.11): "+18.8% 🍖 Emilio" rising
// out of the pet and fading. The scene renders them inside the canvas; the
// same information also lands in the DOM's aria-live log (SPEC §11.3) —
// this is the decorative copy.

export type Toast = {
  text: string;
  bornMs: number;
  lane: number;
};

const TOAST_LIFE_MS = 2600;
const MAX_TOASTS = 6;

export class Toasts {
  private readonly items: Toast[] = [];
  private nextLane = 0;

  push(text: string, nowMs: number): void {
    this.items.push({ text, bornMs: nowMs, lane: this.nextLane });
    this.nextLane = (this.nextLane + 1) % 3;
    while (this.items.length > MAX_TOASTS) this.items.shift();
  }

  render(ctx: CanvasRenderingContext2D, nowMs: number, centerX: number, baseY: number): void {
    ctx.textAlign = "center";
    ctx.font = "7px 'Press Start 2P', monospace";
    for (const toast of this.items) {
      const age = nowMs - toast.bornMs;
      if (age > TOAST_LIFE_MS) continue;
      const progress = age / TOAST_LIFE_MS;
      const rise = progress * 34;
      const x = Math.round(centerX + (toast.lane - 1) * 26);
      const y = Math.round(baseY - rise);
      ctx.globalAlpha = progress < 0.75 ? 1 : (1 - progress) / 0.25;
      ctx.fillStyle = "#131017";
      ctx.fillText(toast.text, x + 1, y + 1);
      ctx.fillStyle = "#f5f0dc";
      ctx.fillText(toast.text, x, y);
    }
    ctx.globalAlpha = 1;
  }
}
