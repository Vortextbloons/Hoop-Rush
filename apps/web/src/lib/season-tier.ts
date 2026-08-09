/**
 * Presentation tiers for completed 82-game sandbox seasons.
 * Breakpoints mirror NBA-style win bands on an 82-game schedule.
 */

export type SeasonTier = 'perfect' | 'contender' | 'playoff' | 'lottery' | 'tanking';

export interface SeasonTierInfo {
  tier: SeasonTier;
  label: string;
  badgeClass: string;
  iconClass: string;
}

const TIER_STYLES: Record<SeasonTier, Pick<SeasonTierInfo, 'badgeClass' | 'iconClass'>> = {
  perfect: {
    badgeClass: 'border-primary/40 bg-primary/10 text-primary',
    iconClass: 'bg-primary/15 text-primary',
  },
  contender: {
    badgeClass: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
    iconClass: 'bg-amber-400/15 text-amber-300',
  },
  playoff: {
    badgeClass: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
    iconClass: 'bg-sky-400/15 text-sky-300',
  },
  lottery: {
    badgeClass: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
    iconClass: 'bg-yellow-500/15 text-yellow-300',
  },
  tanking: {
    badgeClass: 'border-destructive/40 bg-destructive/10 text-destructive',
    iconClass: 'bg-destructive/10 text-destructive',
  },
};

export function seasonTierFromWins(wins: number): SeasonTierInfo {
  if (wins >= 82) {
    return { tier: 'perfect', label: '82-0 · perfect', ...TIER_STYLES.perfect };
  }
  if (wins >= 55) {
    return { tier: 'contender', label: '82 games · contender', ...TIER_STYLES.contender };
  }
  if (wins >= 42) {
    return { tier: 'playoff', label: '82 games · playoff', ...TIER_STYLES.playoff };
  }
  if (wins >= 30) {
    return { tier: 'lottery', label: '82 games · lottery', ...TIER_STYLES.lottery };
  }
  return { tier: 'tanking', label: '82 games · tanking', ...TIER_STYLES.tanking };
}
