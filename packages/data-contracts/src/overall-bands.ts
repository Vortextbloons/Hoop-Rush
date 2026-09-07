export interface OverallBand {
  label: string;
  min: number;
  max: number;
  share: number;
}
export const OVERALL_BANDS: readonly OverallBand[] = [
  { label: '97-99', min: 97, max: 99, share: 0.008 },
  { label: '94-96', min: 94, max: 96, share: 0.016 },
  { label: '90-93', min: 90, max: 93, share: 0.042 },
  { label: '86-89', min: 86, max: 89, share: 0.084 },
  { label: '82-85', min: 82, max: 85, share: 0.145 },
  { label: '78-81', min: 78, max: 81, share: 0.205 },
  { label: '74-77', min: 74, max: 77, share: 0.23 },
  { label: '70-73', min: 70, max: 73, share: 0.155 },
  { label: '65-69', min: 65, max: 69, share: 0.08 },
  { label: '40-64', min: 40, max: 64, share: 0.035 },
];
function clampRatingBand(value: number): number {
  return Math.min(99, Math.max(40, Math.round(value)));
}
export function overallBandForPercentile(
  p: number,
  bands: readonly OverallBand[] = OVERALL_BANDS,
): number {
  let start = 0;
  for (const band of bands) {
    const end = start + band.share;
    if (p < end - 1e-9 || band === bands[bands.length - 1]) {
      const span = Math.max(1e-9, end - start);
      return clampRatingBand(band.max - ((p - start) / span) * (band.max - band.min));
    }
    start = end;
  }
  return 40;
}
