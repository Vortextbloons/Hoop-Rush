export function ratio(numerator: number, denominator: number, fallback: number): number {
  return denominator > 0 ? numerator / denominator : fallback;
}

export function shrunkRatio(
  numerator: number,
  denominator: number,
  prior: number,
  priorAttempts = 80,
): number {
  return denominator > 0
    ? (numerator + prior * priorAttempts) / (denominator + priorAttempts)
    : prior;
}
