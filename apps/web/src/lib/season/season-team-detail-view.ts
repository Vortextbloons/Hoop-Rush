import type {
  SeasonGameSummary,
  SeasonLeague,
  SeasonPlayerAggregate,
  SeasonRotation,
  SeasonRoster,
  SeasonRosterEntry,
  SeasonStandings,
} from '@hoop-rush/data-contracts';
import { foldSeasonAggregates, pointDifferential } from './season-presentation';
import { rotationRoleOf } from './season-rotation-editor';

/**
 * Season Run team detail view-model (M2.5 team drill-down): joins one
 * franchise's ten roster entries to its locked rotation and its folded
 * player aggregates, purely from recorded facts. AI rotations are frozen
 * for the run, so the locked rotation is authoritative; the human team's
 * pending rotation is not shown here (the Rotation tab owns that).
 *
 * Everything displayed derives from saved contracts — never invented here.
 */

export interface SeasonTeamPlayerStats {
  gamesPlayed: number;
  minutesPerGame: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
  stealsPerGame: number;
  blocksPerGame: number;
  turnoversPerGame: number;
}

export interface SeasonTeamPlayerRow {
  playerVersionId: string;
  displayName: string;
  seasonKey: string;
  franchiseId: string;
  eraId: string;
  overallRating: number | null;
  positions: readonly string[];
  role: string;
  minutes: number;
  closing: boolean;
  stats: SeasonTeamPlayerStats | null;
}

export interface SeasonTeamDetail {
  franchiseId: string;
  conference: 'east' | 'west';
  wins: number;
  losses: number;
  gamesPlayed: number;
  diff: number;
  /** Five starters in slot order (G, G, F, F, C). */
  starters: SeasonTeamPlayerRow[];
  /** Five bench players in deterministic bench order. */
  bench: SeasonTeamPlayerRow[];
  /** Ordered closing five (independent of the starters). */
  closingFive: SeasonTeamPlayerRow[];
  /** Sum of the ten target minutes (always 240 for a legal rotation). */
  minutesTotal: number;
  hasStats: boolean;
}

export function seasonTeamDetail(input: {
  roster: SeasonRoster;
  rotation: SeasonRotation;
  standings: SeasonStandings;
  league: SeasonLeague;
  summaries: readonly SeasonGameSummary[];
  overallRatingOf: (playerVersionId: string) => number | null;
  playablePositions: (playerVersionId: string) => readonly string[];
}): SeasonTeamDetail | null {
  const { roster, rotation, standings, league, summaries } = input;
  const standingsRow = standings.rows.find((row) => row.franchiseId === roster.franchiseId);
  if (standingsRow === undefined) return null;
  const conference =
    league.teams.find((team) => team.franchiseId === roster.franchiseId)?.conference ?? 'east';

  const aggregates = new Map<string, SeasonPlayerAggregate>();
  for (const player of foldSeasonAggregates(summaries).players) {
    aggregates.set(player.playerVersionId, player);
  }
  const minutesOf = new Map(
    rotation.targetMinutes.map((target) => [target.playerVersionId, target.minutes]),
  );
  const closing = new Set(rotation.closingFive);

  const byVersion = new Map(roster.players.map((entry) => [entry.playerVersionId, entry]));
  const rowOf = (entry: SeasonRosterEntry): SeasonTeamPlayerRow | null => {
    const aggregate = aggregates.get(entry.playerVersionId) ?? null;
    const games = aggregate?.gamesPlayed ?? 0;
    const rate = (value: number): number => (games > 0 ? value / games : 0);
    return {
      playerVersionId: entry.playerVersionId,
      displayName: entry.displayName,
      seasonKey: entry.seasonKey,
      franchiseId: entry.franchiseId,
      eraId: entry.eraId,
      overallRating: input.overallRatingOf(entry.playerVersionId),
      positions: input.playablePositions(entry.playerVersionId),
      role: rotationRoleOf(rotation, entry.playerVersionId),
      minutes: minutesOf.get(entry.playerVersionId) ?? 0,
      closing: closing.has(entry.playerVersionId),
      stats:
        aggregate === null
          ? null
          : {
              gamesPlayed: games,
              minutesPerGame: rate(aggregate.seconds) / 60,
              pointsPerGame: rate(aggregate.points),
              reboundsPerGame: rate(aggregate.offensiveRebounds + aggregate.defensiveRebounds),
              assistsPerGame: rate(aggregate.assists),
              stealsPerGame: rate(aggregate.steals),
              blocksPerGame: rate(aggregate.blocks),
              turnoversPerGame: rate(aggregate.turnovers),
            },
    };
  };

  const starters: SeasonTeamPlayerRow[] = [];
  const bench: SeasonTeamPlayerRow[] = [];
  for (const playerVersionId of rotation.starters) {
    const entry = byVersion.get(playerVersionId);
    const row = entry === undefined ? null : rowOf(entry);
    if (row !== null) starters.push(row);
  }
  for (const playerVersionId of rotation.benchOrder) {
    const entry = byVersion.get(playerVersionId);
    const row = entry === undefined ? null : rowOf(entry);
    if (row !== null) bench.push(row);
  }
  const closingFive: SeasonTeamPlayerRow[] = [];
  for (const playerVersionId of rotation.closingFive) {
    const entry = byVersion.get(playerVersionId);
    const row = entry === undefined ? null : rowOf(entry);
    if (row !== null) closingFive.push(row);
  }

  return {
    franchiseId: roster.franchiseId,
    conference,
    wins: standingsRow.wins,
    losses: standingsRow.losses,
    gamesPlayed: standingsRow.gamesPlayed,
    diff: pointDifferential(standingsRow),
    starters,
    bench,
    closingFive,
    minutesTotal: rotation.targetMinutes.reduce((sum, target) => sum + target.minutes, 0),
    hasStats: summaries.length > 0,
  };
}
