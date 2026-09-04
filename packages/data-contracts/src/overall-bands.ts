export interface OverallBand {
  label: string;
  min: number;
  max: number;
  share: number;
}

export const OVERALL_BANDS: readonly OverallBand[] = [
  { label: '95-99', min: 95, max: 99, share: 0.003 },
  { label: '90-94', min: 90, max: 94, share: 0.025 },
  { label: '85-89', min: 85, max: 89, share: 0.125 },
  { label: '72-84', min: 72, max: 84, share: 0.547 },
  { label: '40-71', min: 40, max: 71, share: 0.3 },
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
