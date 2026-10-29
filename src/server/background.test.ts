import { afterEach, describe, expect, it, vi } from "vitest";
import { inBackground } from "./background";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("inBackground", () => {
  it("logs a failed task under its name, and nothing goes unhandled", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const error = new Error("store down");
    try {
      inBackground(Promise.reject(error), "presence touch");
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(log).toHaveBeenCalledExactlyOnceWith("presence touch failed", error);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("stays quiet when the task succeeds", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    inBackground(Promise.resolve("ok"), "slot refresh");
    await new Promise((resolve) => setImmediate(resolve));
    expect(log).not.toHaveBeenCalled();
  });
});
