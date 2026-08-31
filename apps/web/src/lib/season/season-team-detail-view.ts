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
export interface SeasonSummaryRatings {
  overallRating: number;
  offenseRating: number;
  defenseRating: number;
}
export interface SeasonTeamProjection {
  overall: number;
  offense: number;
  defense: number;
}
export interface SeasonTeamProjectionRaw {
  overall: number;
  offense: number;
  defense: number;
}
export interface LeagueProjectionBaselines {
  overall: {
    min: number;
    max: number;
  };
  offense: {
    min: number;
    max: number;
  };
  defense: {
    min: number;
    max: number;
  };
}
const TEAM_PROJECTION_DISPLAY_FLOOR = 58;
const TEAM_PROJECTION_DISPLAY_CEILING = 94;
const TEAM_PROJECTION_MINUTE_EXPONENT = 1.4;
function minuteProjectionWeight(minutes: number): number {
  return Math.pow(minutes, TEAM_PROJECTION_MINUTE_EXPONENT);
}
function statRange(values: readonly number[]): {
  min: number;
  max: number;
} {
  if (values.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...values), max: Math.max(...values) };
}
function mapStatToDisplay(
  raw: number,
  range: {
    min: number;
    max: number;
  },
): number {
  if (range.max <= range.min) {
    return Math.round((TEAM_PROJECTION_DISPLAY_FLOOR + TEAM_PROJECTION_DISPLAY_CEILING) / 2);
  }
  const scaled =
    TEAM_PROJECTION_DISPLAY_FLOOR +
    ((raw - range.min) / (range.max - range.min)) *
      (TEAM_PROJECTION_DISPLAY_CEILING - TEAM_PROJECTION_DISPLAY_FLOOR);
  return Math.max(
    TEAM_PROJECTION_DISPLAY_FLOOR,
    Math.min(TEAM_PROJECTION_DISPLAY_CEILING, Math.round(scaled)),
  );
}
export function rawSeasonTeamRatings(input: {
  roster: SeasonRoster;
  rotation: SeasonRotation;
  summaryRatingsOf: (playerVersionId: string) => SeasonSummaryRatings | null;
}): SeasonTeamProjectionRaw | null {
  const minutes = new Map(
    input.rotation.targetMinutes.map((target) => [target.playerVersionId, target.minutes]),
  );
  const acc = { overall: 0, offense: 0, defense: 0 };
  let totalWeight = 0;
  for (const entry of input.roster.players) {
    const rating = input.summaryRatingsOf(entry.playerVersionId);
    const minutesPlayed = minutes.get(entry.playerVersionId) ?? 0;
    if (rating === null || minutesPlayed <= 0) continue;
    const weight = minuteProjectionWeight(minutesPlayed);
    totalWeight += weight;
    acc.overall += rating.overallRating * weight;
    acc.offense += rating.offenseRating * weight;
    acc.defense += rating.defenseRating * weight;
  }
  if (totalWeight <= 0) return null;
  return {
    overall: acc.overall / totalWeight,
    offense: acc.offense / totalWeight,
    defense: acc.defense / totalWeight,
  };
}
export function buildLeagueProjectionBaselines(input: {
  rosters: readonly SeasonRoster[];
  rotations: readonly SeasonRotation[];
  summaryRatingsOf: (playerVersionId: string) => SeasonSummaryRatings | null;
}): LeagueProjectionBaselines | null {
  const rotationByFranchise = new Map(
    input.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const rawProjections: SeasonTeamProjectionRaw[] = [];
  for (const roster of input.rosters) {
    const rotation = rotationByFranchise.get(roster.franchiseId);
    if (rotation === undefined) continue;
    const raw = rawSeasonTeamRatings({
      roster,
      rotation,
      summaryRatingsOf: input.summaryRatingsOf,
    });
    if (raw !== null) rawProjections.push(raw);
  }
  if (rawProjections.length === 0) return null;
  return {
    overall: statRange(rawProjections.map((row) => row.overall)),
    offense: statRange(rawProjections.map((row) => row.offense)),
    defense: statRange(rawProjections.map((row) => row.defense)),
  };
}
export function normalizeTeamProjection(
  raw: SeasonTeamProjectionRaw,
  baselines: LeagueProjectionBaselines,
): SeasonTeamProjection {
  return {
    overall: mapStatToDisplay(raw.overall, baselines.overall),
    offense: mapStatToDisplay(raw.offense, baselines.offense),
    defense: mapStatToDisplay(raw.defense, baselines.defense),
  };
}
export function seasonLeagueTeamProjections(input: {
  rosters: readonly SeasonRoster[];
  rotations: readonly SeasonRotation[];
  summaryRatingsOf: (playerVersionId: string) => SeasonSummaryRatings | null;
  rotationOverrides?: ReadonlyMap<string, SeasonRotation>;
}): Map<string, SeasonTeamProjection> {
  const baselines = buildLeagueProjectionBaselines({
    rosters: input.rosters,
    rotations: input.rotations,
    summaryRatingsOf: input.summaryRatingsOf,
  });
  if (baselines === null) return new Map();
  const rotationByFranchise = new Map(
    input.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const projections = new Map<string, SeasonTeamProjection>();
  for (const roster of input.rosters) {
    const rotation =
      input.rotationOverrides?.get(roster.franchiseId) ??
      rotationByFranchise.get(roster.franchiseId);
    if (rotation === undefined) continue;
    const raw = rawSeasonTeamRatings({
      roster,
      rotation,
      summaryRatingsOf: input.summaryRatingsOf,
    });
    if (raw === null) continue;
    projections.set(roster.franchiseId, normalizeTeamProjection(raw, baselines));
  }
  return projections;
}
export function seasonTeamRatings(input: {
  roster: SeasonRoster;
  rotation: SeasonRotation;
  summaryRatingsOf: (playerVersionId: string) => SeasonSummaryRatings | null;
  leagueBaselines?: LeagueProjectionBaselines | null;
}): SeasonTeamProjection | null {
  const raw = rawSeasonTeamRatings(input);
  if (raw === null) return null;
  const baselines =
    input.leagueBaselines ??
    buildLeagueProjectionBaselines({
      rosters: [input.roster],
      rotations: [input.rotation],
      summaryRatingsOf: input.summaryRatingsOf,
    });
  if (baselines === null) return null;
  return normalizeTeamProjection(raw, baselines);
}
export interface SeasonTeamDetail {
  franchiseId: string;
  conference: 'east' | 'west';
  wins: number;
  losses: number;
  gamesPlayed: number;
  diff: number;
  starters: SeasonTeamPlayerRow[];
  bench: SeasonTeamPlayerRow[];
  closingFive: SeasonTeamPlayerRow[];
  minutesTotal: number;
  hasStats: boolean;
  projection: SeasonTeamProjection | null;
}
export function seasonTeamDetail(input: {
  roster: SeasonRoster;
  rotation: SeasonRotation;
  rosters: readonly SeasonRoster[];
  rotations: readonly SeasonRotation[];
  standings: SeasonStandings;
  league: SeasonLeague;
  summaries: readonly SeasonGameSummary[];
  overallRatingOf: (playerVersionId: string) => number | null;
  summaryRatingsOf: (playerVersionId: string) => SeasonSummaryRatings | null;
  playablePositions: (playerVersionId: string) => readonly string[];
}): SeasonTeamDetail | null {
  const { roster, rotation, rosters, rotations, standings, league, summaries } = input;
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
    projection:
      seasonLeagueTeamProjections({
        rosters,
        rotations,
        summaryRatingsOf: input.summaryRatingsOf,
      }).get(roster.franchiseId) ?? null,
  };
}
