import {
  eraSimulationProfileSchema,
  fullCourtDraftStateSchema,
  havocInstanceSeed,
  type CapRushCatalogSource,
  type CapRushPayrollStatus,
  type EraSimulationProfile,
  type FullCourtDraftState,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonKey,
  type Seed,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import { assertCapRushCatalogSourceMatches } from '../cap-rush/catalog.ts';
import { capRushAssignFranchise, type CapRushLeagueField } from '../cap-rush/league-schedule.ts';
import { fullCourtDraftIndexOf, fullCourtSalaryDollarsOf } from './draft-catalog.ts';
import {
  fullCourtEffectiveRatings,
  fullCourtPayrollDollars,
  fullCourtPayrollStatus,
} from './draft-economy.ts';
import type { FullCourtGameInput, FullCourtTeamGameInput } from './game.ts';
import { runFullCourtGameWithHealth, type FullCourtGameHealthOptions } from './health.ts';
import {
  buildFullCourtHistoricalField,
  buildFullCourtLeagueSchedule,
  type FullCourtLeagueGame,
} from './league.ts';
import { adaptCapRushSpinsToFullCourt } from './roulette.ts';
import { assertFullCourtSpinReceiptDigests } from './roulette-draft.ts';

export interface FullCourtRegularSeasonTeam extends FullCourtTeamGameInput {
  readonly anchorSeason: SeasonKey | null;
}

export interface FullCourtRegularSeason {
  readonly runId: FullCourtDraftState['runId'];
  readonly runSeed: Seed;
  readonly catalog: CapRushCatalogSource;
  readonly profile: EraSimulationProfile;
  readonly userTeamId: string;
  readonly teams: readonly FullCourtRegularSeasonTeam[];
  readonly games: readonly FullCourtLeagueGame[];
}

function simulationRoster(
  players: readonly SeasonDraftCandidate[],
  apron: CapRushPayrollStatus,
): SimulationPlayer[] {
  return players.map((player) => ({
    playerId: player.playerId,
    playerVersionId: player.playerVersionId,
    displayName: player.displayName,
    positions: player.positions.playable,
    heightInches: player.heightInches,
    weightLbs: player.weightLbs,
    ratings: fullCourtEffectiveRatings(player.detailedRatings, apron),
    tendencies: player.tendencies,
    anchors: player.anchors,
    reconstructedThreePoint: player.reconstructedThreePoint,
    overall: player.summaryRatings.overallRating,
  }));
}

function staminaAvailability(players: readonly SeasonDraftCandidate[]) {
  return players.map((player) => ({
    playerId: player.playerId,
    available: true,
    staminaRating: player.stamina.rating,
  }));
}

export function buildFullCourtRegularSeason(input: {
  readonly draft: FullCourtDraftState;
  readonly field: readonly CapRushLeagueField[];
  readonly catalog: SeasonDraftCatalog;
  readonly catalogSource: CapRushCatalogSource;
  readonly profile: EraSimulationProfile;
}): FullCourtRegularSeason {
  const { field, catalog, catalogSource } = input;
  const draft = fullCourtDraftStateSchema.parse(input.draft);
  if (draft.stage !== 'complete') {
    throw new Error('A confirmed Full Court roster is required to start the season');
  }
  if (draft.variant === 'roulette' && draft.roulette?.status === 'open') {
    throw new Error('Finalize Full Court Roulette before starting the season');
  }
  if (draft.variant === 'roulette' && draft.roulette?.status === 'skipped') {
    throw new Error('Finalize Full Court Roulette before starting the season');
  }
  assertFullCourtSpinReceiptDigests(draft);
  const profile = eraSimulationProfileSchema.parse(input.profile);
  assertCapRushCatalogSourceMatches(catalogSource, draft.catalog);
  const index = fullCourtDraftIndexOf(catalog, catalogSource);
  const candidates = new Map(
    catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const chosen = draft.picks.map((pick) => {
    const versionId = pick.player.playerVersionId;
    const player = index.byVersionId.get(versionId);
    const candidate = candidates.get(versionId);
    if (
      player === undefined ||
      candidate === undefined ||
      player.playerId !== pick.player.playerId ||
      fullCourtSalaryDollarsOf(player) !== pick.salaryDollars
    ) {
      throw new Error(`Full Court draft pick ${versionId} differs from the pinned catalog`);
    }
    return candidate;
  });

  const runSeed = draft.runSeed;
  const games = buildFullCourtLeagueSchedule({ field, runSeed });
  const assignment = capRushAssignFranchise({ field, runSeed });
  const opponents = buildFullCourtHistoricalField({
    field: field.filter((team) => team.teamId !== assignment.franchiseId),
    catalog,
    runSeed,
  });
  const apron = fullCourtPayrollStatus(fullCourtPayrollDollars(draft.picks), draft.money);
  const userRoster = simulationRoster(chosen, apron);
  const userSourceRoster = simulationRoster(chosen, 'under-cap');
  const rouletteReceipts = draft.roulette?.receipts ?? [];
  const userRoulette =
    rouletteReceipts.length === 0
      ? undefined
      : adaptCapRushSpinsToFullCourt({
          roster: userRoster,
          sourceRoster: userSourceRoster,
          receipts: rouletteReceipts,
          payrollStatus: apron,
        });
  const teams: FullCourtRegularSeasonTeam[] = [
    {
      teamId: assignment.franchiseId,
      displayName: assignment.displayName,
      anchorSeason: null,
      roster: userRoster,
      availability: staminaAvailability(chosen),
      ...(userRoulette === undefined ? {} : { roulette: userRoulette }),
    },
    ...opponents.map((team) => {
      const roster = simulationRoster(team.players, 'under-cap');
      const idByVersion = new Map(
        team.players.map((player) => [player.playerVersionId, player.playerId]),
      );
      const startingFive = team.starterVersionIds.map((versionId) => {
        const id = idByVersion.get(versionId);
        if (id === undefined) throw new Error(`Full Court starter ${versionId} is missing`);
        return id;
      });
      return {
        teamId: team.teamId,
        displayName: team.displayName,
        anchorSeason: team.seasonKey,
        roster,
        rotation: { startingFive },
        availability: staminaAvailability(team.players),
      };
    }),
  ];
  return {
    runId: draft.runId,
    runSeed,
    catalog: draft.catalog,
    profile,
    userTeamId: assignment.franchiseId,
    teams,
    games,
  };
}

export interface FullCourtSeasonIndex {
  readonly gameById: ReadonlyMap<string, FullCourtLeagueGame>;
  readonly gamesBySlot: ReadonlyMap<number, readonly FullCourtLeagueGame[]>;
  readonly teamById: ReadonlyMap<string, FullCourtRegularSeasonTeam>;
  readonly futureDaysByGameSide: ReadonlyMap<string, readonly number[]>;
}

const SEASON_INDEX_CACHE = new WeakMap<FullCourtRegularSeason, FullCourtSeasonIndex>();

/** Derived fixture lookups for the immutable locked season; safe to reuse across slots. */
export function fullCourtSeasonIndexOf(season: FullCourtRegularSeason): FullCourtSeasonIndex {
  const cached = SEASON_INDEX_CACHE.get(season);
  if (cached !== undefined) return cached;
  const gameById = new Map<string, FullCourtLeagueGame>();
  const gamesBySlot = new Map<number, FullCourtLeagueGame[]>();
  for (const game of season.games) {
    gameById.set(game.gameId, game);
    const slotGames = gamesBySlot.get(game.slot);
    if (slotGames === undefined) gamesBySlot.set(game.slot, [game]);
    else slotGames.push(game);
  }
  const teamById = new Map(season.teams.map((team) => [team.teamId, team]));
  const futureDaysByGameSide = new Map<string, readonly number[]>();
  const gamesByTeam = new Map<string, FullCourtLeagueGame[]>();
  for (const game of season.games) {
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      const teamGames = gamesByTeam.get(teamId);
      if (teamGames === undefined) gamesByTeam.set(teamId, [game]);
      else teamGames.push(game);
    }
  }
  for (const [teamId, teamGames] of gamesByTeam) {
    teamGames.sort((left, right) => left.slot - right.slot || left.dayOffset - right.dayOffset);
    const futureDays: number[] = [];
    for (let index = teamGames.length - 1; index >= 0; index -= 1) {
      const game = teamGames[index];
      if (game === undefined) continue;
      futureDaysByGameSide.set(`${game.gameId}:${teamId}`, [...futureDays]);
      futureDays.unshift(game.dayOffset);
    }
  }
  const index: FullCourtSeasonIndex = { gameById, gamesBySlot, teamById, futureDaysByGameSide };
  SEASON_INDEX_CACHE.set(season, index);
  return index;
}

export function fullCourtFutureDaysOf(
  season: FullCourtRegularSeason,
  fixture: FullCourtLeagueGame,
  teamId: string,
): readonly number[] {
  return (
    fullCourtSeasonIndexOf(season).futureDaysByGameSide.get(`${fixture.gameId}:${teamId}`) ?? []
  );
}

export function fullCourtRegularSeasonGameInput(
  season: FullCourtRegularSeason,
  gameId: string,
): FullCourtGameInput {
  return gameInputOf(season, scheduledGameOf(season, gameId));
}

export function simulateFullCourtRegularSeasonGame(
  season: FullCourtRegularSeason,
  gameId: string,
  context: EngineContext,
  options: FullCourtGameHealthOptions = {},
) {
  const fixture = scheduledGameOf(season, gameId);
  return runFullCourtGameWithHealth(
    gameInputOf(season, fixture),
    fixture.dayOffset,
    context,
    options,
  );
}

function scheduledGameOf(season: FullCourtRegularSeason, gameId: string): FullCourtLeagueGame {
  const fixture = fullCourtSeasonIndexOf(season).gameById.get(gameId);
  if (fixture === undefined) throw new Error(`Full Court game ${gameId} is not on the schedule`);
  return fixture;
}

function gameInputOf(
  season: FullCourtRegularSeason,
  fixture: FullCourtLeagueGame,
): FullCourtGameInput {
  const index = fullCourtSeasonIndexOf(season);
  const home = index.teamById.get(fixture.homeTeamId);
  const away = index.teamById.get(fixture.awayTeamId);
  if (home === undefined || away === undefined)
    throw new Error(`Full Court game ${fixture.gameId} has an unknown team`);
  return {
    schemaVersion: 1,
    seed: havocInstanceSeed(season.runSeed, 'full-court-regular-game-v1', fixture.gameId),
    gameNumber: fixture.slot,
    dataVersion: season.catalog.dataVersion,
    profile: season.profile,
    home,
    away,
  };
}
