import type { SeasonLeaderCategory, SeasonPlayerAggregate } from '@hoop-rush/data-contracts';

export const CATEGORY_CHAMPION_LABELS: Record<SeasonLeaderCategory, string> = {
  points: 'Scoring champion',
  rebounds: 'Rebounding champion',
  assists: 'Assist champion',
  steals: 'Steals champion',
  blocks: 'Blocks champion',
  threePointersMade: 'Three-point champion',
};

export const CATEGORY_UNITS: Record<SeasonLeaderCategory, string> = {
  points: 'PPG',
  rebounds: 'RPG',
  assists: 'APG',
  steals: 'SPG',
  blocks: 'BPG',
  threePointersMade: '3PG',
};

export interface HonorsLine {
  gamesPlayed: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  threePointersMade: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  threePg: number;
}

export function honorsLineOf(
  aggregate: SeasonPlayerAggregate | null | undefined,
): HonorsLine | null {
  if (!aggregate || aggregate.gamesPlayed <= 0) return null;
  const gp = aggregate.gamesPlayed;
  const rebounds = aggregate.offensiveRebounds + aggregate.defensiveRebounds;
  return {
    gamesPlayed: gp,
    points: aggregate.points,
    rebounds,
    assists: aggregate.assists,
    steals: aggregate.steals,
    blocks: aggregate.blocks,
    threePointersMade: aggregate.threePointersMade,
    ppg: aggregate.points / gp,
    rpg: rebounds / gp,
    apg: aggregate.assists / gp,
    spg: aggregate.steals / gp,
    bpg: aggregate.blocks / gp,
    threePg: aggregate.threePointersMade / gp,
  };
}

export function awardStatLine(
  aggregate: SeasonPlayerAggregate | null | undefined,
  kind: 'mvp' | 'dpoy' | 'sixth-man' | 'first-team',
): string | null {
  const line = honorsLineOf(aggregate);
  if (!line) return null;
  if (kind === 'dpoy') {
    return `${line.bpg.toFixed(1)} BLK · ${line.rpg.toFixed(1)} REB · ${line.spg.toFixed(1)} STL`;
  }
  return `${line.ppg.toFixed(1)} PPG · ${line.rpg.toFixed(1)} REB · ${line.apg.toFixed(1)} AST`;
}

export function firstTeamStatLine(
  aggregate: SeasonPlayerAggregate | null | undefined,
): string | null {
  return awardStatLine(aggregate, 'first-team');
}

export function aggregateMapOf(
  players: readonly SeasonPlayerAggregate[] | null | undefined,
): Map<string, SeasonPlayerAggregate> {
  const map = new Map<string, SeasonPlayerAggregate>();
  for (const row of players ?? []) map.set(row.playerVersionId, row);
  return map;
}
