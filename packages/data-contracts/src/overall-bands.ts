export interface OverallBand {
  label: string;
  min: number;
  max: number;
  share: number;
}
export const OVERALL_BANDS: readonly OverallBand[] = [
  { label: '97-99', min: 97, max: 99, share: 0.003 },
  { label: '94-96', min: 94, max: 96, share: 0.01 },
  { label: '90-93', min: 90, max: 93, share: 0.025 },
  { label: '86-89', min: 86, max: 89, share: 0.085 },
  { label: '82-85', min: 82, max: 85, share: 0.127 },
  { label: '78-81', min: 78, max: 81, share: 0.17 },
  { label: '74-77', min: 74, max: 77, share: 0.15 },
  { label: '70-73', min: 70, max: 73, share: 0.15 },
  { label: '65-69', min: 65, max: 69, share: 0.14 },
  { label: '40-64', min: 40, max: 64, share: 0.14 },
];
function integerSlices(band: OverallBand): { overall: number; share: number }[] {
  const count = band.max - band.min + 1;
  const weightSum = (count * (count + 1)) / 2;
  const slices: { overall: number; share: number }[] = [];
  for (let step = 0; step < count; step += 1) {
    slices.push({
      overall: band.max - step,
      share: (band.share * (step + 1)) / weightSum,
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
