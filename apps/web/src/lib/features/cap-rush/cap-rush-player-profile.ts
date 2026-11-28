import type { CapRushSourcePlayer } from '@hoop-rush/data-contracts';
import { CAP_RUSH_CAP_LINE_DOLLARS, CAP_RUSH_FIRST_APRON_DOLLARS } from '@hoop-rush/data-contracts';
import { capRushApronReductions } from '@hoop-rush/engine';
import type {
  PlayerApronReduction,
  PlayerApronStatus,
  PlayerApronView,
} from '#lib/players/player-apron.js';
import {
  apronHeadlineReductions,
  apronTierLabel,
  apronTierShortLabel,
} from '#lib/players/player-apron.js';
import { defaultSlotForPositions, type PlayerProfileInput } from '#lib/players/player-profile.js';

/** First- and second-apron rule text, matching the locked-run behaviour. */
const APRON_RULES: Readonly<
  Record<'first' | 'second', { names: readonly string[]; detail: string }>
> = {
  first: {
    names: ['Superstar Syndrome', 'Telegraphed Passes'],
    detail: 'Telegraphed Passes adds 1.5% interception chance to every pass.',
  },
  second: {
    names: ['Locker Room Meltdown', 'Telegraphed Passes', 'Defensive Strike'],
    detail:
      'Telegraphed Passes adds 7% interception chance to every pass, and Defensive Strike fires.',
  },
};

const APRON_REDUCTION_LABELS: Readonly<Record<string, string>> = {
  passing: 'Passing',
  ballHandling: 'Handle',
  offensiveIq: 'Offensive IQ',
  defensiveIq: 'Defensive IQ',
  perimeterDefense: 'Perimeter D',
  interiorDefense: 'Interior D',
  threePoint: 'Three-point',
  midrange: 'Midrange',
  insideScoring: 'Inside scoring',
  closeShot: 'Close shot',
  offensiveRebound: 'Off. rebounding',
  defensiveRebound: 'Def. rebounding',
};

export const NO_APRON: PlayerApronView = {
  status: { kind: 'none' },
  reductions: [],
  rules: [],
  ruleDetail: null,
};

function tierOf(payrollDollars: number): 'first' | 'second' | null {
  if (payrollDollars <= CAP_RUSH_CAP_LINE_DOLLARS) return null;
  return payrollDollars <= CAP_RUSH_FIRST_APRON_DOLLARS ? 'first' : 'second';
}

function reductionsOf(
  player: CapRushSourcePlayer,
  status: PlayerApronStatus,
): readonly PlayerApronReduction[] {
  if (status.kind === 'none') return [];
  return capRushApronReductions(status.tier === 'first' ? 'first-apron' : 'second-apron').map(
    (entry) => {
      const original = player.profile.ratings[entry.field];
      return {
        label: APRON_REDUCTION_LABELS[entry.field] ?? entry.field,
        original,
        effective: Math.max(0, original - entry.reduction),
      };
    },
  );
}

function viewOf(player: CapRushSourcePlayer, status: PlayerApronStatus): PlayerApronView {
  if (status.kind === 'none') return NO_APRON;
  const rule = APRON_RULES[status.tier];
  return {
    status,
    reductions: reductionsOf(player, status),
    rules: rule.names,
    ruleDetail: rule.detail,
  };
}

/**
 * Apron exposure for a player already signed into a locked lineup. The status
 * comes from the locked payroll, so it can only be `applied` or `none`.
 */
export function capRushLockedApron(
  player: CapRushSourcePlayer,
  payrollDollars: number,
): PlayerApronView {
  const tier = tierOf(payrollDollars);
  if (tier === null) return NO_APRON;
  return viewOf(player, { kind: 'applied', tier, payrollDollars });
}

/**
 * Apron exposure a signing would create. Returns `none` while the resulting
 * payroll stays under the cap, which is what keeps the apron UI out of the way
 * during an ordinary draft.
 */
export function capRushProjectedApron(
  player: CapRushSourcePlayer,
  payrollAfterSigningDollars: number,
): PlayerApronView {
  const tier = tierOf(payrollAfterSigningDollars);
  if (tier === null) return NO_APRON;
  return viewOf(player, { kind: 'projected', tier, payrollDollars: payrollAfterSigningDollars });
}

/** One-line card strip text, or null when no apron applies. */
export function capRushApronStrip(view: PlayerApronView): string | null {
  if (view.status.kind === 'none') return null;
  const headline = apronHeadlineReductions(view.reductions)
    .map((row) => `${row.label} \u2212${String(row.original - row.effective)}`)
    .join(', ');
  return `${apronTierShortLabel(view.status.tier)} \u00b7 ${headline}`;
}

export function capRushApronHeadline(view: PlayerApronView): string | null {
  if (view.status.kind === 'none') return null;
  return apronTierLabel(view.status.tier);
}

/** Profile input shared by the draft card and the lineup, so both agree. */
export function capRushProfileInput(
  player: CapRushSourcePlayer,
  franchiseLabel: string,
  slot?: string | null,
): PlayerProfileInput {
  return {
    displayName: player.displayName,
    franchiseLabel,
    seasonKey: player.seasonKey,
    positions: player.positions,
    heightInches: player.physical.heightInches,
    weightLbs: player.physical.weightLbs,
    overall: player.originalOverall,
    offense: null,
    defense: null,
    ratings: player.profile.ratings,
    tendencies: player.profile.tendencies,
    anchors: player.profile.anchors ?? null,
    slot: slot ?? defaultSlotForPositions(player.positions),
  };
}

export function capRushProfileSamples(players: readonly CapRushSourcePlayer[]): readonly {
  positions: readonly string[];
  ratings: CapRushSourcePlayer['profile']['ratings'];
  tendencies: CapRushSourcePlayer['profile']['tendencies'];
}[] {
  return players.map((player) => ({
    positions: player.positions,
    ratings: player.profile.ratings,
    tendencies: player.profile.tendencies,
  }));
}
