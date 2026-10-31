import type {
  CapRushFranchiseAssignment,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerSeatLock,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerVersionLocks,
  CapRushPlayoffPerformance,
  CapRushSourcePlayer,
  EraSimulationProfile,
  HavocSourcePlayer,
  HavocTeamInput,
  OpponentBracket,
  PlayoffPerformance,
  Seed,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  CAP_RUSH_TAKEOVER_TEAMS,
  capRushAlignmentOf,
  capRushMultiplayerFranchiseSeed,
  capRushMultiplayerLockedInputsSchema,
} from '@hoop-rush/data-contracts';
import { createRng } from '../../../sim/rng.ts';
import { buildHavocOpponentTeam } from '../../havoc/opponents.ts';
import {
  buildCapRushLeagueSchedule,
  capRushLeagueFieldOf,
  capRushValidateLeagueField,
  type CapRushLeagueField,
  type CapRushLeagueSchedule,
} from '../league-schedule.ts';
import { capRushPlayoffProfilesOf } from '../lock.ts';
import { capRushPlayoffPerformanceOf } from '../playoff.ts';

export interface CapRushMultiplayerFranchisePair {
  readonly p1: CapRushFranchiseAssignment;
  readonly p2: CapRushFranchiseAssignment;
}

function assignmentOf(
  field: readonly CapRushLeagueField[],
  teamId: string,
): CapRushFranchiseAssignment {
  const team = field.find((entry) => entry.teamId === teamId);
  if (team === undefined) throw new Error(`cap rush multiplayer: unknown franchise ${teamId}`);
  const alignment = capRushAlignmentOf(teamId);
  return {
    franchiseId: team.teamId,
    displayName: team.displayName,
    conference: alignment.conference,
    division: alignment.division,
  };
}

export function capRushMultiplayerAssignFranchises(input: {
  readonly rootSeed: Seed;
  readonly field: readonly CapRushLeagueField[];
}): CapRushMultiplayerFranchisePair {
  const ordered = [...input.field].sort((left, right) =>
    left.teamId < right.teamId ? -1 : left.teamId > right.teamId ? 1 : 0,
  );
  if (ordered.length !== CAP_RUSH_TAKEOVER_TEAMS) {
    throw new Error(
      `cap rush multiplayer: franchise assignment needs ${String(CAP_RUSH_TAKEOVER_TEAMS)} teams`,
    );
  }
  const west = ordered.filter((team) => capRushAlignmentOf(team.teamId).conference === 'west');
  const east = ordered.filter((team) => capRushAlignmentOf(team.teamId).conference === 'east');
  const rng = createRng(capRushMultiplayerFranchiseSeed(input.rootSeed));
  const westTeam = rng.pick(west);
  const eastTeam = rng.pick(east);
  const westFirst = rng.chance(0.5);
  const first = westFirst ? westTeam : eastTeam;
  const second = westFirst ? eastTeam : westTeam;
  return {
    p1: assignmentOf(input.field, first.teamId),
    p2: assignmentOf(input.field, second.teamId),
  };
}

function opponentTeamOf(input: {
  readonly rootSeed: Seed;
  readonly opponent: OpponentBracket['opponents'][number];
  readonly profile: EraSimulationProfile;
}): HavocTeamInput {
  const team = buildHavocOpponentTeam({
    runSeed: input.rootSeed,
    opponent: input.opponent,
    profile: input.profile,
  }).team;
  const withSeason = (participant: HavocTeamInput['starters'][number]) => ({
    ...participant,
    source: { ...participant.source, seasonKey: input.opponent.seasonKey },
  });
  return {
    ...team,
    starters: team.starters.map(withSeason),
    replacements: team.replacements.map(withSeason),
  };
}

function playoffProfilesOf(input: {
  readonly catalog: SeasonDraftCatalog;
  readonly seats: readonly CapRushMultiplayerSeatLock[];
}): ReadonlyMap<string, PlayoffPerformance> {
  const profiles = new Map<string, PlayoffPerformance>();
  for (const candidate of input.catalog.candidates) {
    if (candidate.playoffPerformance !== undefined) {
      profiles.set(candidate.playerVersionId, candidate.playoffPerformance);
    }
  }
  for (const seat of input.seats) {
    for (const starter of seat.team.starters) {
      const versionId = starter.source.playerVersionId;
      if (versionId === null) continue;
      const candidate = input.catalog.candidates.find(
        (entry) => entry.playerVersionId === versionId,
      );
      if (candidate?.playoffPerformance !== undefined) {
        profiles.set(versionId, candidate.playoffPerformance);
      }
    }
  }
  return profiles;
}

function performanceOf(input: {
  readonly human: HavocTeamInput;
  readonly opponents: readonly HavocTeamInput[];
  readonly profiles: ReadonlyMap<string, PlayoffPerformance>;
}): CapRushPlayoffPerformance {
  return capRushPlayoffPerformanceOf({
    human: input.human,
    opponents: input.opponents.map((team) => ({ team })),
    profileOf: (source: HavocSourcePlayer) =>
      source.playerVersionId === null ? undefined : input.profiles.get(source.playerVersionId),
  });
}

export function buildCapRushMultiplayerLockedInputs(input: {
  readonly roomId: string;
  readonly rootSeed: Seed;
  readonly variant: CapRushMultiplayerLockedInputs['variant'];
  readonly versionLocks: CapRushMultiplayerVersionLocks;
  readonly catalog: CapRushMultiplayerLockedInputs['catalog'];
  readonly profile: EraSimulationProfile;
  readonly seats: {
    readonly p1: CapRushMultiplayerSeatLock;
    readonly p2: CapRushMultiplayerSeatLock;
  };
  readonly bracket: OpponentBracket;
  readonly seasonCatalog: SeasonDraftCatalog;
  readonly schedule?: CapRushLeagueSchedule;
}): CapRushMultiplayerLockedInputs {
  const seatTeams = [input.seats.p1, input.seats.p2];
  const humanIds = new Set(seatTeams.map((seat) => seat.franchise.franchiseId));
  const field = capRushLeagueFieldOf(input.bracket).filter((team) => !humanIds.has(team.teamId));
  for (const seat of seatTeams) {
    field.push({
      teamId: seat.franchise.franchiseId,
      displayName: seat.franchise.displayName,
    });
  }
  capRushValidateLeagueField(field);
  const opponents = input.bracket.opponents
    .filter((opponent) => !humanIds.has(opponent.teamId))
    .map((opponent) => ({
      opponentId: opponent.teamId,
      team: opponentTeamOf({
        rootSeed: input.rootSeed,
        opponent,
        profile: input.profile,
      }),
    }));
  const schedule = input.schedule ?? buildCapRushLeagueSchedule({ runSeed: input.rootSeed, field });
  const profiles = playoffProfilesOf({ catalog: input.seasonCatalog, seats: seatTeams });
  const allTeams = [...seatTeams.map((seat) => seat.team), ...opponents.map((entry) => entry.team)];
  const p1Performance = performanceOf({
    human: input.seats.p1.team,
    opponents: allTeams.filter((team) => team.teamId !== input.seats.p1.team.teamId),
    profiles,
  });
  const p2Performance = performanceOf({
    human: input.seats.p2.team,
    opponents: allTeams.filter((team) => team.teamId !== input.seats.p2.team.teamId),
    profiles,
  });
  return capRushMultiplayerLockedInputsSchema.parse({
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    roomId: input.roomId,
    rootSeed: input.rootSeed,
    variant: input.variant,
    versionLocks: input.versionLocks,
    profile: input.profile,
    catalog: input.catalog,
    seats: input.seats,
    opponents,
    leagueSchedule: schedule.games,
    playoffPerformance: {
      p1: p1Performance,
      p2: p2Performance,
    },
  });
}

export function capRushMultiplayerTeamById(
  locked: CapRushMultiplayerLockedInputs,
  teamId: string,
): HavocTeamInput {
  if (locked.seats.p1.franchise.franchiseId === teamId) return locked.seats.p1.team;
  if (locked.seats.p2.franchise.franchiseId === teamId) return locked.seats.p2.team;
  const opponent = locked.opponents.find((entry) => entry.team.teamId === teamId);
  if (opponent === undefined) {
    throw new Error(`cap rush multiplayer: unknown team ${teamId}`);
  }
  return opponent.team;
}

export function capRushMultiplayerSeatOfTeam(
  locked: CapRushMultiplayerLockedInputs,
  teamId: string,
): CapRushMultiplayerSeatId | null {
  if (locked.seats.p1.franchise.franchiseId === teamId) return 'p1';
  if (locked.seats.p2.franchise.franchiseId === teamId) return 'p2';
  return null;
}

export function capRushMultiplayerFieldOfLocked(locked: CapRushMultiplayerLockedInputs): {
  readonly teamId: string;
  readonly displayName: string;
  readonly isUserTeam: boolean;
}[] {
  const seats = [locked.seats.p1, locked.seats.p2];
  return [
    ...seats.map((seat) => ({
      teamId: seat.franchise.franchiseId,
      displayName: seat.franchise.displayName,
      isUserTeam: true,
    })),
    ...locked.opponents.map((entry) => ({
      teamId: entry.team.teamId,
      displayName: entry.team.displayName,
      isUserTeam: false,
    })),
  ];
}

export function capRushMultiplayerPlayoffPlayerSource(
  player: CapRushSourcePlayer,
): HavocSourcePlayer {
  return {
    playerId: player.playerId,
    playerVersionId: player.playerVersionId,
    displayName: player.displayName,
    franchiseId: player.franchiseId,
    eraId: player.eraId,
    seasonKey: player.seasonKey,
    positions: player.positions,
    originalOverall: player.originalOverall,
    overallSource: 'catalog',
    profile: player.profile,
    physical: player.physical,
  };
}

export function capRushMultiplayerProfilesFromPicks(
  catalog: SeasonDraftCatalog,
): ReadonlyMap<string, PlayoffPerformance> {
  return capRushPlayoffProfilesOf({ catalog, picks: [] });
}
