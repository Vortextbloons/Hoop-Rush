export interface OverallBand {
  label: string;
  min: number;
  max: number;
  share: number;
}
export const OVERALL_BANDS: readonly OverallBand[] = [
  { label: '100', min: 100, max: 100, share: 0.001 },
  { label: '95-99', min: 95, max: 99, share: 0.0068 },
  { label: '90-94', min: 90, max: 94, share: 0.0379 },
  { label: '85-89', min: 85, max: 89, share: 0.0683 },
  { label: '80-84', min: 80, max: 84, share: 0.1351 },
  { label: '75-79', min: 75, max: 79, share: 0.2438 },
  { label: '70-74', min: 70, max: 74, share: 0.2438 },
  { label: '65-69', min: 65, max: 69, share: 0.1317 },
  { label: '60-64', min: 60, max: 64, share: 0.0439 },
  { label: '50-59', min: 50, max: 59, share: 0.0293 },
  { label: '40-49', min: 40, max: 49, share: 0.0584 },
];
function integerSlices(band: OverallBand): { overall: number; share: number }[] {
  const count = band.max - band.min + 1;
  const slices: { overall: number; share: number }[] = [];
  for (let step = 0; step < count; step += 1) {
    slices.push({
      overall: band.max - step,
      share: band.share / count,
    });
  }
  return slices;
}
export function overallBandForPercentile(
  p: number,
  bands: readonly OverallBand[] = OVERALL_BANDS,
): number {
  const percentile = Math.min(1, Math.max(0, p));
  let start = 0;
  const lastBand = bands[bands.length - 1];
  for (const band of bands) {
    const slices = integerSlices(band);
    for (const slice of slices) {
      const end = start + slice.share;
      const lastSlice = band === lastBand && slice.overall === band.min;
      if (percentile < end - 1e-9 || lastSlice) return slice.overall;
      start = end;
    }
  }
  return 40;
}
export function overallBandIndexOf(
  overall: number,
  bands: readonly OverallBand[] = OVERALL_BANDS,
): number {
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    if (band !== undefined && overall >= band.min && overall <= band.max) return index;
  }
  const first = bands[0];
  if (first !== undefined && overall > first.max) return 0;
  return Math.max(0, bands.length - 1);
}
