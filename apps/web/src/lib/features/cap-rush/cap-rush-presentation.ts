import type {
  CapRushBucket,
  CapRushPayrollStatus,
  CapRushVariant,
} from '@hoop-rush/data-contracts';
import { capRushApronReductions, type CapRushApronReduction } from '@hoop-rush/engine';

export function variantLabel(variant: CapRushVariant): string {
  return variant === 'clash' ? 'Cap Clash' : 'Cap Roulette';
}

export function initialsOf(displayName: string): string {
  return displayName
    .split(' ')
    .filter((part) => part.length > 0)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function formatMillions(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const thousands = Math.round(Math.abs(amount) / 1_000);
  const millions = thousands / 1_000;
  const text = Number.isInteger(millions)
    ? String(millions)
    : millions.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return `${sign}$${text}M`;
}

export function capStatusLabel(status: CapRushPayrollStatus): string {
  switch (status) {
    case 'under-cap':
      return 'Under the cap';
    case 'first-apron':
      return 'First apron';
    case 'second-apron':
      return 'Second apron';
    case 'illegal':
      return 'Over the hard limit';
  }
}

export function capStatusShortLabel(status: CapRushPayrollStatus): string {
  switch (status) {
    case 'under-cap':
      return 'Under';
    case 'first-apron':
      return '1st apron';
    case 'second-apron':
      return '2nd apron';
    case 'illegal':
      return 'Over';
  }
}

export function capStatusClass(status: CapRushPayrollStatus): string {
  switch (status) {
    case 'under-cap':
      return 'border-positive/40 bg-positive/10 text-positive';
    case 'first-apron':
      return 'border-accent/50 bg-accent/10 text-accent';
    case 'second-apron':
      return 'border-primary/50 bg-primary/10 text-primary';
    case 'illegal':
      return 'border-negative/50 bg-negative/10 text-negative';
  }
}

export function bucketLabel(bucket: CapRushBucket): string {
  switch (bucket) {
    case 'star':
      return 'Star';
    case 'strong':
      return 'Strong';
    case 'rotation':
      return 'Rotation';
    case 'budget':
      return 'Budget';
    case 'wildcard':
      return 'Wildcard';
  }
}

export function bucketClass(bucket: CapRushBucket): string {
  switch (bucket) {
    case 'star':
      return 'border-accent/50 bg-accent/10 text-accent';
    case 'strong':
      return 'border-primary/40 bg-primary/10 text-primary';
    case 'rotation':
      return 'border-line-strong bg-surface-2 text-foreground';
    case 'budget':
      return 'border-line-soft bg-surface-1 text-muted-foreground';
    case 'wildcard':
      return 'border-dashed border-line-strong bg-surface-1 text-foreground';
  }
}

const RATING_LABELS: Record<string, string> = {
  passing: 'Passing',
  ballHandling: 'Ball handling',
  offensiveIq: 'Offensive IQ',
  defensiveIq: 'Defensive IQ',
  perimeterDefense: 'Perimeter defense',
  interiorDefense: 'Interior defense',
  threePoint: 'Three-point',
  midrange: 'Midrange',
  insideScoring: 'Inside scoring',
  closeShot: 'Close shot',
  offensiveRebound: 'Off. rebounding',
  defensiveRebound: 'Def. rebounding',
};

export interface ApronPenaltyRow {
  readonly label: string;
  readonly reduction: number;
}

export function apronPenaltyRows(status: CapRushPayrollStatus): ApronPenaltyRow[] {
  return capRushApronReductions(status).map((entry: CapRushApronReduction): ApronPenaltyRow => ({
    label: RATING_LABELS[entry.field] ?? entry.field,
    reduction: entry.reduction,
  }));
}

export function apronPenaltyTitle(status: CapRushPayrollStatus): string {
  switch (status) {
    case 'first-apron':
      return 'Superstar Syndrome + Give Me the Ball';
    case 'second-apron':
      return 'Locker Room Meltdown + Hero Ball + Defensive Strike';
    default:
      return 'No apron penalties';
  }
}

export interface ApronImpactRow {
  readonly label: string;
  readonly original: number;
  readonly effective: number;
  readonly reduction: number;
}

export function apronImpact(
  ratings: Readonly<Record<string, number>>,
  status: CapRushPayrollStatus,
): ApronImpactRow[] {
  return capRushApronReductions(status).map((entry: CapRushApronReduction) => {
    const original = ratings[entry.field] ?? 0;
    return {
      label: RATING_LABELS[entry.field] ?? entry.field,
      original,
      effective: Math.max(0, original - entry.reduction),
      reduction: entry.reduction,
    };
  });
}

export const KEY_RATING_FIELDS = [
  ['insideScoring', 'Inside'],
  ['closeShot', 'Close'],
  ['midrange', 'Midrange'],
  ['threePoint', 'Three'],
  ['freeThrow', 'Free throw'],
  ['ballHandling', 'Handle'],
  ['passing', 'Passing'],
  ['offensiveIq', 'Off. IQ'],
  ['offensiveRebound', 'Off. reb'],
  ['defensiveRebound', 'Def. reb'],
  ['perimeterDefense', 'Perimeter D'],
  ['interiorDefense', 'Interior D'],
  ['steal', 'Steal'],
  ['block', 'Block'],
  ['defensiveIq', 'Def. IQ'],
  ['speed', 'Speed'],
  ['strength', 'Strength'],
  ['vertical', 'Vertical'],
] as const;
