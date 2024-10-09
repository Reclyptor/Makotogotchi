export const range = (end: number, start: number = 0): number[] => {
  return Array.from({ length: end - start }, (_, i) => start + i);
};