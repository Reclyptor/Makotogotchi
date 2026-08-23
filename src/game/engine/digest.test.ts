// The digest's one dangerous failure is a false match: a frame that would
// look different but hashes the same is a scene frozen on the canvas. So
// these lean on the side of proving that things which change the picture
// change the hash — including the ones a naive recorder misses, where the
// call arguments are identical and only the context state around them moved.

import { describe, expect, it } from "vitest";
import { DigestContext } from "./digest";

const hashOf = (draw: (ctx: DigestContext) => void): number => {
  const ctx = new DigestContext();
  ctx.reset();
  draw(ctx);
  return ctx.value;
};

describe("what the digest can tell apart", () => {
  it("gives the same frame the same hash", () => {
    const frame = (ctx: DigestContext): void => {
      ctx.fillStyle = "#abc";
      ctx.fillRect(1, 2, 3, 4);
      ctx.drawImage({} as CanvasImageSource, 0, 0, 8, 8, 10, 20, 8, 8);
    };
    expect(hashOf(frame)).toBe(hashOf(frame));
  });

  it("is not fooled by a fresh recorder", () => {
    const ctx = new DigestContext();
    ctx.reset();
    ctx.fillRect(1, 2, 3, 4);
    const first = ctx.value;
    ctx.reset();
    ctx.fillRect(1, 2, 3, 4);
    expect(ctx.value).toBe(first);
  });

  it("notices a rectangle that moved", () => {
    expect(hashOf((c) => c.fillRect(1, 2, 3, 4))).not.toBe(hashOf((c) => c.fillRect(1, 3, 3, 4)));
  });

  it("notices a colour change under identical geometry", () => {
    expect(
      hashOf((c) => {
        c.fillStyle = "#fff";
        c.fillRect(0, 0, 4, 4);
      }),
    ).not.toBe(
      hashOf((c) => {
        c.fillStyle = "#000";
        c.fillRect(0, 0, 4, 4);
      }),
    );
  });

  it("notices an alpha change under identical geometry", () => {
    expect(
      hashOf((c) => {
        c.globalAlpha = 1;
        c.fillRect(0, 0, 4, 4);
      }),
    ).not.toBe(
      hashOf((c) => {
        c.globalAlpha = 0.5;
        c.fillRect(0, 0, 4, 4);
      }),
    );
  });

  it("notices a different sprite frame drawn to the same place", () => {
    const at = (sx: number) => hashOf((c) => c.drawImage({} as CanvasImageSource, sx, 0, 8, 8, 4, 4, 8, 8));
    expect(at(0)).not.toBe(at(16));
  });

  // The pet is mirrored by translating to its position and scaling by -1, then
  // drawing at zero. The draw call is byte-identical wherever the pet stands,
  // so a recorder that ignores the transform would freeze a strolling pet.
  it("notices a translate, though the draw call never changes", () => {
    const strollTo = (x: number) =>
      hashOf((c) => {
        c.save();
        c.translate(x, 0);
        c.scale(-1, 1);
        c.drawImage({} as CanvasImageSource, 0, 0, 8, 8, 0, 40, 8, 8);
        c.restore();
      });
    expect(strollTo(100)).not.toBe(strollTo(101));
  });

  it("notices a mirrored pet against an unmirrored one", () => {
    const facing = (mirrored: boolean) =>
      hashOf((c) => {
        c.save();
        c.translate(100, 0);
        if (mirrored) c.scale(-1, 1);
        c.drawImage({} as CanvasImageSource, 0, 0, 8, 8, 0, 40, 8, 8);
        c.restore();
      });
    expect(facing(true)).not.toBe(facing(false));
  });

  it("notices sub-pixel motion, which a rounded scene may still show later", () => {
    expect(hashOf((c) => c.fillRect(0.25, 0, 1, 1))).not.toBe(hashOf((c) => c.fillRect(0.5, 0, 1, 1)));
  });

  it("restores transform and paint state with the stack", () => {
    const nested = hashOf((c) => {
      c.save();
      c.translate(50, 0);
      c.restore();
      c.fillRect(0, 0, 1, 1);
    });
    const plain = hashOf((c) => {
      c.save();
      c.restore();
      c.fillRect(0, 0, 1, 1);
    });
    expect(nested).toBe(plain);
  });

  it("notices a clip, so a masked frame is not mistaken for an unmasked one", () => {
    const clipped = hashOf((c) => {
      c.beginPath();
      c.rect(0, 0, 10, 10);
      c.clip();
      c.fillRect(0, 0, 4, 4);
    });
    const open = hashOf((c) => c.fillRect(0, 0, 4, 4));
    expect(clipped).not.toBe(open);
  });

  it("notices a clip rectangle that moved", () => {
    const clipAt = (y: number) =>
      hashOf((c) => {
        c.beginPath();
        c.rect(0, y, 10, 10);
        c.clip();
        c.fillRect(0, 0, 4, 4);
      });
    expect(clipAt(0)).not.toBe(clipAt(4));
  });

  it("notices toast text changing without moving", () => {
    const say = (text: string) =>
      hashOf((c) => {
        c.font = "7px monospace";
        c.fillText(text, 10, 10);
      });
    expect(say("+1.8% 🍖 you")).not.toBe(say("+1.9% 🍖 you"));
  });

  it("notices draw order, since later pixels cover earlier ones", () => {
    const order = (first: string) =>
      hashOf((c) => {
        c.fillStyle = first;
        c.fillRect(0, 0, 4, 4);
        c.fillStyle = first === "#fff" ? "#000" : "#fff";
        c.fillRect(0, 0, 4, 4);
      });
    expect(order("#fff")).not.toBe(order("#000"));
  });

  it("hands back a usable ImageData so the no-offscreen-canvas path still runs", () => {
    const ctx = new DigestContext();
    const image = ctx.createImageData(4, 4);
    expect(image.data.length).toBe(4 * 4 * 4);
    image.data.set(new Uint8ClampedArray(4 * 4 * 4).fill(7));
    expect(() => ctx.putImageData(image, 0, 0)).not.toThrow();
  });
});
