export function drawHexInt(seed: string): number {
  return Number.parseInt(seed.slice(0, 8), 16);
}
