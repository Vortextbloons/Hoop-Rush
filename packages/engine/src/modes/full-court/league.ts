import {
  havocInstanceSeed,
  type CapRushLeagueScheduleEntry,
  type PlayerVersionId,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonKey,
  type Seed,
} from '@hoop-rush/data-contracts';
import { createRng } from '../../sim/rng.ts';
import { NBA_LEAGUE_RULES } from '../../league/nba.ts';
import { buildLeagueSchedule, type LeagueFieldTeam } from '../../league/schedule.ts';
import {
  adjacentHistoricalPlayers,
  chooseHistoricalTeam,
  compareHistoricalMinutes,
  groupHistoricalRosters,
  historicalLeagueStrengthTarget,
  historicalLineupOf,
} from '../historical-rosters.ts';

const MIN_HISTORICAL_ROSTER_SIZE = 10;
const MAX_HISTORICAL_ROSTER_SIZE = 12;

export interface FullCourtHistoricalTeam extends LeagueFieldTeam {
  readonly seasonKey: SeasonKey;
  readonly players: readonly SeasonDraftCandidate[];
  readonly starterVersionIds: readonly PlayerVersionId[];
}

function projectedStrength(players: readonly SeasonDraftCandidate[]): number {
  let workload = 0;
  let weightedOverall = 0;
  for (const player of players) {
    const minutes = Math.max(1, player.stamina.historicalMpg);
    workload += minutes;
    weightedOverall += player.summaryRatings.overallRating * minutes;
  }
  return weightedOverall / workload;
}

function historicalDepth(
  starters: readonly SeasonDraftCandidate[],
  anchor: readonly SeasonDraftCandidate[],
  adjacent: readonly SeasonDraftCandidate[],
): SeasonDraftCandidate[] {
  const players = [...starters];
  const selected = new Set(players.map((player) => player.playerId));
  function addReserves(candidates: readonly SeasonDraftCandidate[], size: number): void {
    for (const player of [...candidates].sort(compareHistoricalMinutes)) {
      if (players.length >= size) break;
      if (selected.has(player.playerId)) continue;
      selected.add(player.playerId);
      players.push(player);
    }
  }
  addReserves(anchor, MAX_HISTORICAL_ROSTER_SIZE);
  addReserves(adjacent, MIN_HISTORICAL_ROSTER_SIZE);
  return players;
}

export function buildFullCourtHistoricalField(input: {
  readonly field: readonly LeagueFieldTeam[];
  readonly catalog: SeasonDraftCatalog;
  readonly runSeed: Seed;
  readonly variedStrength?: boolean;
}): readonly FullCourtHistoricalTeam[] {
  const { field, catalog, runSeed, variedStrength } = input;
  const seasons = groupHistoricalRosters(catalog);
  const strengthRng = createRng(havocInstanceSeed(runSeed, 'full-court-league-strength-v1'));
  const target = variedStrength
    ? 62 + strengthRng.next() * 30
    : historicalLeagueStrengthTarget(strengthRng);
  return field.map((team) => {
    const years = seasons.get(team.teamId) ?? new Map<SeasonKey, readonly SeasonDraftCandidate[]>();
    const choices = [...years]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([seasonKey, anchor]) => {
        const adjacent = adjacentHistoricalPlayers(years, seasonKey);
        const pool = [...anchor, ...adjacent];
        const starters =
          historicalLineupOf(anchor, seasonKey) ??
          historicalLineupOf(pool, seasonKey, 1) ??
          historicalLineupOf(pool, seasonKey, 2);
        if (starters === null) return [];
        const players = historicalDepth(starters, anchor, adjacent);
        if (players.length < MIN_HISTORICAL_ROSTER_SIZE) return [];
        return [
          {
            seasonKey,
            players,
            starterVersionIds: starters.map((player) => player.playerVersionId),
            distance: Math.abs(projectedStrength(players) - target),
          },
        ];
      });
    if (choices.length === 0) {
      throw new Error(`Full Court has no historical rotation for ${team.teamId}`);
    }
    const rng = createRng(
      havocInstanceSeed(runSeed, 'full-court-historical-field-v1', team.teamId),
    );
    const nearest = Math.min(...choices.map((choice) => choice.distance));
    const { seasonKey, players, starterVersionIds } = variedStrength
      ? rng.weightedPick(
          choices,
          choices.map(({ distance }) => Math.exp(-(distance - nearest) / 4)),
        )
      : chooseHistoricalTeam(choices, rng);
    return { ...team, seasonKey, players, starterVersionIds };
  });
}

export interface FullCourtLeagueGame extends CapRushLeagueScheduleEntry {
  readonly dayOffset: number;
}

export function buildFullCourtLeagueSchedule(input: {
  readonly field: readonly LeagueFieldTeam[];
  readonly runSeed: Seed;
}): readonly FullCourtLeagueGame[] {
  const { games } = buildLeagueSchedule({ ...input, rules: NBA_LEAGUE_RULES });
  return games.map((game) => {
    const slotIndex = game.slot - 1;
    const dayRng = createRng(
      havocInstanceSeed(input.runSeed, 'full-court-calendar-v1', game.gameId),
    );
    return {
      ...game,
      dayOffset: 2 * slotIndex + 2 * Math.floor(slotIndex / 20) + dayRng.nextInt(0, 1),
    };
  });
}
