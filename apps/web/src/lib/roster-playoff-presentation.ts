import type { PlayoffPerformance } from '@hoop-rush/data-contracts';

export interface RosterPlayoffComparisonRow {
  readonly label: string;
  readonly regular: string;
  readonly playoffs: string;
  readonly delta: string;
}

function signedFixed(value: number, digits: number): string {
  const rounded = Math.abs(value).toFixed(digits);
  if (Number(rounded) === 0) return (0).toFixed(digits);
  return `${value < 0 ? '−' : '+'}${rounded}`;
}

function sharePct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function per36(total: number, minutes: number): string {
  if (minutes <= 0) return '—';
  return signedFixed((total / minutes) * 36, 1);
}

function signedPer36(value: number | null): string {
  return value === null ? '—' : signedFixed(value, 1);
}

function signedTsDelta(value: number | null): string {
  return value === null ? '—' : `${signedFixed(value * 100, 1)} pp`;
}

export function rosterPlayoffSampleLabel(performance: PlayoffPerformance): string {
  const games = performance.playoffs.gamesPlayed;
  const minutes = Math.round(performance.playoffs.minutes);
  return `${String(games)} GP · ${String(minutes)} min`;
}

export function rosterPlayoffComparisonRows(
  performance: PlayoffPerformance,
): RosterPlayoffComparisonRow[] {
  const reg = performance.regularSeason;
  const post = performance.playoffs;
  const diff = performance.differences;
  return [
    {
      label: 'True shooting',
      regular: sharePct(reg.tsPct),
      playoffs: sharePct(post.tsPct),
      delta: signedTsDelta(diff.tsPct),
    },
    {
      label: 'Points',
      regular: `${per36(reg.points, reg.minutes)}/36`,
      playoffs: `${per36(post.points, post.minutes)}/36`,
      delta: diff.pointsPer36 === null ? '—' : `${signedPer36(diff.pointsPer36)}/36`,
    },
    {
      label: 'Assists',
      regular: `${per36(reg.assists, reg.minutes)}/36`,
      playoffs: `${per36(post.assists, post.minutes)}/36`,
      delta: diff.assistsPer36 === null ? '—' : `${signedPer36(diff.assistsPer36)}/36`,
    },
    {
      label: 'Rebounds',
      regular: `${per36(reg.rebounds, reg.minutes)}/36`,
      playoffs: `${per36(post.rebounds, post.minutes)}/36`,
      delta: diff.reboundsPer36 === null ? '—' : `${signedPer36(diff.reboundsPer36)}/36`,
    },
    {
      label: 'Turnovers',
      regular: reg.turnovers === null ? '—' : `${per36(reg.turnovers, reg.minutes)}/36`,
      playoffs: post.turnovers === null ? '—' : `${per36(post.turnovers, post.minutes)}/36`,
      delta: diff.turnoversPer36 === null ? '—' : `${signedPer36(diff.turnoversPer36)}/36`,
    },
  ];
}
