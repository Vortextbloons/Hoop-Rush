export interface PeakCase {
  key: string;
  season: string;
  position: string;
  height: number;
  winPct: number;
  approximate?: boolean;
  stats: Record<string, number | null>;
}
