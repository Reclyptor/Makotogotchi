// The contract between the Shell (which owns the /api/play protocol) and a
// game component (which owns a canvas and its mechanics).

export type GameProps = {
  /** The shared sprite sheet, fully loaded before the game mounts. */
  sheet: HTMLImageElement;
  /** Report the current score whenever it changes; the Shell throttles the
   * broadcast to the server's 2s guard. */
  reportScore: (score: number) => void;
  /** End the run exactly once with the final score and total input count. */
  finish: (score: number, inputs: number) => void;
};
