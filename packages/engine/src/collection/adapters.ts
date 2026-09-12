import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_NEUTRAL_HOME_COURT,
  COLLECTION_GAME_V1_VERSION,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionPreparedGameUnion,
  type EraSimulationProfile,
  type SeasonGameSimulationInput,
  type SeasonGameTeamInput,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { resolveCollectionCard, toCollectionSimulationPlayer } from './cards.ts';
import { materializeAdjustedCpuRatings } from './difficulty.ts';

export const COLLECTION_PLAYER_TEAM_ID = 'collection-player';
export const COLLECTION_CPU_TEAM_ID = 'collection-cpu';

function teamInput(
  team: CollectionActiveTeam,
  catalogById: Map<string, CollectionCatalogCard>,
  teamId: string,
  displayName: string,
  ratingsOverride?: ReadonlyMap<string, SimulationRatings>,
): SeasonGameTeamInput {
  const roster = [...team.starters, ...team.bench];
  const players = roster.map((cardId) => {
    const card = catalogById.get(cardId);
    if (card === undefined) {
      throw new Error(`collection game adapter: unknown card ${cardId}`);
    }
    const resolved = resolveCollectionCard(card, card);
    const sim = toCollectionSimulationPlayer(resolved, card);
    const player = {
      playerVersionId: cardId,
      playerId: card.playerId,
      displayName: sim.displayName,
      positions: sim.positions,
      heightInches: sim.heightInches,
      weightLbs: sim.weightLbs,
      ratings: ratingsOverride?.get(cardId) ?? sim.ratings,
      tendencies: sim.tendencies,
      ...(sim.anchors !== undefined ? { anchors: sim.anchors } : {}),
      overall: card.summarySource?.overallRating ?? 60,
    };
    return player;
  });
  return {
    teamId,
    displayName,
    franchiseId: teamId,
    players,
  } as unknown as SeasonGameTeamInput;
}

function rotationInput(team: CollectionActiveTeam, teamId: string, closingFive: readonly string[]) {
  return {
    franchiseId: teamId,
    starters: [...team.starters],
    benchOrder: [...team.bench],
    targetMinutes: team.targetMinutes.map((entry) => ({
      playerVersionId: entry.cardId,
      minutes: entry.minutes,
    })),
    closingFive: [...closingFive],
    minutePolicy: {
      policyVersion: SEASON_MINUTE_POLICY_VERSION,
      strategy: 'balanced',
    },
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}

export function toControllerInput(
  prepared: CollectionPreparedGameUnion,
  catalog: CollectionCatalog,
  profile: EraSimulationProfile,
): SeasonGameSimulationInput {
  const catalogById = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const isV2 = prepared.gameVersion !== COLLECTION_GAME_V1_VERSION;
  const adjustedCpuRatings = isV2 ? materializeAdjustedCpuRatings(prepared, catalog) : undefined;
  const cpuClosingFive = isV2 ? prepared.construction.closingFive : prepared.cpuTeam.starters;
  const home = teamInput(prepared.playerTeam, catalogById, COLLECTION_PLAYER_TEAM_ID, 'Your Team');
  const away = teamInput(
    prepared.cpuTeam,
    catalogById,
    COLLECTION_CPU_TEAM_ID,
    'CPU Team',
    adjustedCpuRatings,
  );
  const homeIds = [...prepared.playerTeam.starters, ...prepared.playerTeam.bench];
  const awayIds = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
  return {
    schemaVersion: 1,
    seed: prepared.seed,
    gameNumber: prepared.gameSequence,
    dataVersion: prepared.catalogVersion,
    profile,
    home,
    away,
    homeRotation: rotationInput(
      prepared.playerTeam,
      COLLECTION_PLAYER_TEAM_ID,
      prepared.playerTeam.starters,
    ),
    awayRotation: rotationInput(prepared.cpuTeam, COLLECTION_CPU_TEAM_ID, cpuClosingFive),
    availability: [
      ...homeIds.map((id) => ({ playerVersionId: id, available: true })),
      ...awayIds.map((id) => ({ playerVersionId: id, available: true })),
    ],
    removals: [],
    returns: [],
    homeCourt: { ...SEASON_NEUTRAL_HOME_COURT },
  } as unknown as SeasonGameSimulationInput;
}
