import type {
  BracketOpponent,
  EraSimulationProfile,
  HavocDraftPick,
  HavocEffectiveProfile,
  HavocFrozenOpponent,
  HavocLockedInputs,
  HavocParticipant,
  HavocPlayerProfile,
  HavocScheduleEntry,
  HavocSourcePlayer,
  HavocTeamInput,
  HavocVersionSet,
  OpponentBracket,
  Position,
  Seed,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_SCHEMA_VERSION,
  POSITIONS,
  havocInstanceIdSchema,
  havocInstanceSeed,
  havocLockedInputsSchema,
  havocPlayerProfileSchema,
  havocSourcePlayerSchema,
  havocTeamInputSchema,
  slotGroupOf,
  summaryRatingsOfRatings,
} from '@hoop-rush/data-contracts';
import { copyHavocPlayerProfile } from './catalog.ts';
import { applyHavocMutationPackage } from './transform.ts';

export const HAVOC_HUMAN_TEAM_ID = 'havoc-human';
export const HAVOC_HUMAN_TEAM_NAME = 'Havoc Five';

function instanceIdOf(seed: Seed, purpose: string, ...keys: readonly (string | number)[]): string {
  return havocInstanceIdSchema.parse(`hvi-${havocInstanceSeed(seed, purpose, ...keys)}`);
}

function copyEffectiveProfile(profile: HavocEffectiveProfile): HavocEffectiveProfile {
  return {
    ratings: { ...profile.ratings },
    tendencies: { ...profile.tendencies },
    physical: { ...profile.physical },
    authoritativeChannels: [...profile.authoritativeChannels],
  };
}

function opponentSourceOf(
  opponent: BracketOpponent,
  profile: EraSimulationProfile,
  player: SimulationPlayer,
  slot: Position,
): HavocSourcePlayer {
  const fallback = summaryRatingsOfRatings(
    player.ratings,
    player.tendencies,
    profile.parameters.league3PARate,
    slotGroupOf(slot),
  );
  const catalogOverall = player.overall;
  const havocProfile: HavocPlayerProfile = copyHavocPlayerProfile(
    havocPlayerProfileSchema.parse({
      ratings: player.ratings,
      tendencies: player.tendencies,
      ...(player.anchors === undefined ? {} : { anchors: player.anchors }),
      ...(player.reconstructedThreePoint === undefined
        ? {}
        : { reconstructedThreePoint: player.reconstructedThreePoint }),
    }),
  );
  return havocSourcePlayerSchema.parse({
    playerId: player.playerId,
    playerVersionId: player.playerVersionId ?? null,
    displayName: player.displayName,
    franchiseId: opponent.teamId,
    eraId: profile.eraId,
    // The bracket team season is not authoritative evidence of a mixed-lineup
    // player's own season, so the opponent source claims no player season key.
    seasonKey: null,
    positions: [...player.positions],
    originalOverall: catalogOverall === undefined ? fallback.overallRating : catalogOverall,
    overallSource: catalogOverall === undefined ? 'derived' : 'catalog',
    profile: havocProfile,
    physical: { heightInches: player.heightInches, weightLbs: player.weightLbs },
  });
}

function opponentSlotPlayers(opponent: BracketOpponent): readonly SimulationPlayer[] {
  const bySlot: (SimulationPlayer | undefined)[] = [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  for (const assignment of opponent.lineup.assignments) {
    if (bySlot[assignment.slotIndex] !== undefined) {
      throw new Error(
        `havoc opponent ${opponent.opponentId} has a duplicate lineup slot ${String(assignment.slotIndex)}`,
      );
    }
    const player = opponent.players.find((candidate) => candidate.playerId === assignment.playerId);
    if (player === undefined) {
      throw new Error(
        `havoc opponent ${opponent.opponentId} lineup references unknown player ${assignment.playerId}`,
      );
    }
    bySlot[assignment.slotIndex] = player;
  }
  return POSITIONS.map((position, index) => {
    const player = bySlot[index];
    if (player === undefined) {
      throw new Error(`havoc opponent ${opponent.opponentId} lineup is missing ${position}`);
    }
    return player;
  });
}

export function buildHavocOpponentTeam(input: {
  readonly runSeed: Seed;
  readonly opponent: BracketOpponent;
  readonly profile: EraSimulationProfile;
}): HavocFrozenOpponent {
  const players = opponentSlotPlayers(input.opponent);
  const starters: HavocParticipant[] = [];
  const replacements: HavocParticipant[] = [];
  for (let index = 0; index < POSITIONS.length; index += 1) {
    const slot = POSITIONS[index];
    const player = players[index];
    if (slot === undefined || player === undefined) {
      throw new Error(`havoc opponent ${input.opponent.opponentId} lineup is incomplete`);
    }
    const source = opponentSourceOf(input.opponent, input.profile, player, slot);
    const starterInstanceId = instanceIdOf(
      input.runSeed,
      'opponent-starter',
      input.opponent.opponentId,
      index,
    );
    const replacementInstanceId = instanceIdOf(
      input.runSeed,
      'opponent-replacement',
      input.opponent.opponentId,
      index,
    );
    starters.push({
      instanceId: starterInstanceId,
      kind: 'starter',
      slot,
      ownerInstanceId: null,
      mutationPackage: [],
      source,
      effective: applyHavocMutationPackage(source, [], { slot }),
    });
    replacements.push({
      instanceId: replacementInstanceId,
      kind: 'replacement',
      slot,
      ownerInstanceId: starterInstanceId,
      mutationPackage: [],
      source,
      effective: applyHavocMutationPackage(source, [], { slot }),
    });
  }
  const team = havocTeamInputSchema.parse({
    side: 'opponent',
    teamId: input.opponent.teamId,
    displayName: input.opponent.displayName,
    starters,
    replacements,
    clones: [],
  });
  return { opponentId: input.opponent.opponentId, team };
}

export function buildHavocSchedule(bracket: OpponentBracket): HavocScheduleEntry[] {
  const opponentIds = new Set(bracket.opponents.map((opponent) => opponent.opponentId));
  const ordered = [...bracket.schedule].sort((left, right) => left.gameNumber - right.gameNumber);
  return ordered.map((entry, index) => {
    if (entry.gameNumber !== index + 1) {
      throw new Error(
        `havoc bracket schedule game numbers must be sequential from 1 (got ${String(entry.gameNumber)} at index ${String(index)})`,
      );
    }
    if (!opponentIds.has(entry.opponentId)) {
      throw new Error(`havoc bracket schedule references unknown opponent ${entry.opponentId}`);
    }
    return {
      gameNumber: entry.gameNumber,
      opponentId: entry.opponentId,
      humanHome: entry.gameNumber % 2 === 1,
    };
  });
}

export function buildHavocHumanTeam(input: {
  readonly runSeed: Seed;
  readonly picks: readonly HavocDraftPick[];
}): HavocTeamInput {
  if (input.picks.length !== POSITIONS.length) {
    throw new Error(
      `havoc human team requires five locked picks (got ${String(input.picks.length)})`,
    );
  }
  const starters = input.picks.map((pick, ordinal) => ({
    instanceId: instanceIdOf(input.runSeed, 'human-starter', ordinal),
    kind: 'starter' as const,
    slot: pick.slot,
    ownerInstanceId: null,
    mutationPackage: pick.card.mutations.map((entry) => ({ ...entry })),
    source: pick.card.source,
    effective: copyEffectiveProfile(pick.card.effective),
  }));
  const replacements = input.picks.map((pick, ordinal) => {
    const starter = starters[ordinal];
    if (starter === undefined) {
      throw new Error(`havoc human team is missing starter ${String(ordinal)}`);
    }
    return {
      instanceId: instanceIdOf(input.runSeed, 'human-replacement', ordinal),
      kind: 'replacement' as const,
      slot: pick.slot,
      ownerInstanceId: starter.instanceId,
      mutationPackage: [],
      source: pick.card.source,
      effective: applyHavocMutationPackage(pick.card.source, [], { slot: pick.slot }),
    };
  });
  const clones = input.picks.flatMap((pick, ordinal) => {
    if (!pick.card.mutations.some((entry) => entry.mutationId === 'clone-army')) return [];
    const starter = starters[ordinal];
    if (starter === undefined) {
      throw new Error(`havoc human team is missing starter ${String(ordinal)}`);
    }
    return [
      {
        instanceId: instanceIdOf(input.runSeed, 'human-clone', ordinal),
        kind: 'clone' as const,
        slot: pick.slot,
        ownerInstanceId: starter.instanceId,
        mutationPackage: [],
        source: pick.card.source,
        effective: copyEffectiveProfile(pick.card.effective),
      },
    ];
  });
  return havocTeamInputSchema.parse({
    side: 'human',
    teamId: HAVOC_HUMAN_TEAM_ID,
    displayName: HAVOC_HUMAN_TEAM_NAME,
    starters,
    replacements,
    clones,
  });
}

export function buildHavocLockedInputs(input: {
  readonly runId: string;
  readonly runSeed: Seed;
  readonly versionSet: HavocVersionSet;
  readonly picks: readonly HavocDraftPick[];
  readonly bracket: OpponentBracket;
  readonly profile: EraSimulationProfile;
}): HavocLockedInputs {
  const schedule = buildHavocSchedule(input.bracket);
  const opponents = input.bracket.opponents.map((opponent) =>
    buildHavocOpponentTeam({ runSeed: input.runSeed, opponent, profile: input.profile }),
  );
  const human = buildHavocHumanTeam({ runSeed: input.runSeed, picks: input.picks });
  return havocLockedInputsSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    runId: input.runId,
    runSeed: input.runSeed,
    versionSet: input.versionSet,
    profile: input.profile,
    human,
    schedule,
    opponents,
    picks: input.picks,
  });
}
