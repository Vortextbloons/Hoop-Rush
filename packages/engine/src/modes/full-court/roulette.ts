import type {
  CapRushPayrollStatus,
  CapRushSourcePlayer,
  HavocAuthoritativeChannel,
  HavocEffectiveProfile,
  HavocMutationEntry,
  HavocMutationId,
  HavocMutationPackage,
  HavocSourcePlayer,
  Position,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_IDS,
  havocEffectiveProfileSchema,
  havocMutationPackageSchema,
  positionSchema,
} from '@hoop-rush/data-contracts';
import { HAVOC_MUTATION_DEFINITIONS, teamExclusiveMutationIdsOf } from '../havoc/mutations.ts';
import { applyHavocMutationPackage } from '../havoc/transform.ts';
import { fullCourtEffectiveRatings } from './draft-economy.ts';
import type { FullCourtTeamGameInput } from './game.ts';
import { FullCourtSetupError } from './rotation.ts';

/**
 * Every Cap Rush / Havoc mutation currently shipped in `HAVOC_MUTATION_IDS` is supported
 * by the Full Court Roulette rotating-game runtime.
 */
export const SUPPORTED_FULL_COURT_ROULETTE_MUTATION_IDS: readonly HavocMutationId[] =
  HAVOC_MUTATION_IDS;

const SUPPORTED_MUTATION_SET: ReadonlySet<string> = new Set(
  SUPPORTED_FULL_COURT_ROULETTE_MUTATION_IDS,
);

const TEAM_EXCLUSIVE_MUTATIONS = teamExclusiveMutationIdsOf(HAVOC_MUTATION_DEFINITIONS);

export function isFullCourtRouletteMutationSupported(mutationId: HavocMutationId): boolean {
  return SUPPORTED_MUTATION_SET.has(mutationId);
}

export function assertSupportedFullCourtRouletteMutations(
  mutationIds: readonly HavocMutationId[],
): void {
  for (const mutationId of mutationIds) {
    if (!isFullCourtRouletteMutationSupported(mutationId)) {
      throw new FullCourtSetupError(
        'invalid-lineup',
        `full court roulette does not support mutation ${mutationId}`,
      );
    }
  }
}

export interface FullCourtRoulettePlayerAttachment {
  readonly playerId: SimulationPlayer['playerId'];
  readonly playerVersionId: NonNullable<SimulationPlayer['playerVersionId']>;
  /** Contextual position pinned when the spin receipt was committed. */
  readonly slot: Position;
  readonly mutationPackage: HavocMutationPackage;
  /**
   * Pre-mutation, pre-apron catalog profile for the player. Needed for exact
   * `body-snatcher` swaps and idempotent apron scaling when `effectiveProfile`
   * is not supplied.
   */
  readonly sourcePlayer?: SimulationPlayer | CapRushSourcePlayer;
  /** Pre-apron mutated effective profile pinned at spin commit time. */
  readonly effectiveProfile?: HavocEffectiveProfile;
  /** Optional deterministic key used by derived RNGs (e.g. for Cap Rush parity). */
  readonly participantKey?: string;
}

export interface FullCourtRouletteTeamInput {
  readonly payrollStatus?: CapRushPayrollStatus;
  readonly attachments: readonly FullCourtRoulettePlayerAttachment[];
}

export interface FullCourtRouletteSpinReceiptLike {
  readonly target: {
    readonly slot: Position;
    readonly playerVersionId: NonNullable<SimulationPlayer['playerVersionId']>;
    readonly playerId?: SimulationPlayer['playerId'];
  };
  readonly entry: HavocMutationEntry;
  readonly additionalEntries?: readonly HavocMutationEntry[];
  readonly effective?: HavocEffectiveProfile;
}

export interface AdaptCapRushSpinsToFullCourtInput {
  readonly roster: readonly SimulationPlayer[];
  readonly receipts: readonly FullCourtRouletteSpinReceiptLike[];
  readonly payrollStatus?: CapRushPayrollStatus;
  /** Optional raw un-aproned catalog profiles matching `roster` by `playerVersionId`. */
  readonly sourceRoster?: readonly (SimulationPlayer | CapRushSourcePlayer)[];
}

export interface ResolvedFullCourtRouletteAttachment {
  readonly playerId: SimulationPlayer['playerId'];
  readonly playerVersionId: string;
  readonly slot: Position;
  readonly participantKey: string;
  readonly sourcePlayer: SimulationPlayer;
  readonly basePlayer: SimulationPlayer;
  readonly physical: HavocEffectiveProfile['physical'];
  readonly authoritativeChannels: ReadonlySet<HavocAuthoritativeChannel>;
  readonly mutations: ReadonlySet<HavocMutationId>;
  readonly mutationOrder: readonly HavocMutationId[];
}

export interface ResolvedFullCourtRouletteTeam {
  readonly payrollStatus: CapRushPayrollStatus;
  readonly roster: readonly SimulationPlayer[];
  readonly attachmentsByPlayerId: ReadonlyMap<string, ResolvedFullCourtRouletteAttachment>;
}

function isCapRushSourcePlayer(
  player: SimulationPlayer | CapRushSourcePlayer,
): player is CapRushSourcePlayer {
  return 'profile' in player && 'physical' in player;
}

function simulationPlayerFromSource(
  rosterPlayer: SimulationPlayer,
  source: SimulationPlayer | CapRushSourcePlayer | undefined,
): SimulationPlayer {
  if (source === undefined) return rosterPlayer;
  if (!isCapRushSourcePlayer(source)) {
    return {
      ...rosterPlayer,
      heightInches: source.heightInches,
      weightLbs: source.weightLbs,
      ratings: { ...source.ratings },
      tendencies: { ...source.tendencies },
      ...(source.anchors === undefined ? {} : { anchors: source.anchors }),
      ...(source.reconstructedThreePoint === undefined
        ? {}
        : { reconstructedThreePoint: source.reconstructedThreePoint }),
      ...(source.overall === undefined ? {} : { overall: source.overall }),
    };
  }
  return {
    ...rosterPlayer,
    heightInches: source.physical.heightInches,
    weightLbs: source.physical.weightLbs,
    ratings: { ...source.profile.ratings },
    tendencies: { ...source.profile.tendencies },
    ...(source.profile.anchors === undefined ? {} : { anchors: source.profile.anchors }),
    ...(source.profile.reconstructedThreePoint === undefined
      ? {}
      : { reconstructedThreePoint: source.profile.reconstructedThreePoint }),
    overall: source.originalOverall,
  };
}

function havocSourceFromSimulation(player: SimulationPlayer): HavocSourcePlayer {
  return {
    playerId: player.playerId,
    playerVersionId: player.playerVersionId ?? null,
    displayName: player.displayName,
    franchiseId: null,
    eraId: null,
    seasonKey: null,
    positions: [...player.positions],
    originalOverall: player.overall ?? player.ratingProfile?.canonicalOverall ?? 75,
    overallSource: 'catalog',
    profile: {
      ratings: player.ratings,
      tendencies: player.tendencies,
      ...(player.anchors === undefined ? {} : { anchors: player.anchors }),
      ...(player.reconstructedThreePoint === undefined
        ? {}
        : { reconstructedThreePoint: player.reconstructedThreePoint }),
    },
    physical: {
      heightInches: player.heightInches,
      weightLbs: player.weightLbs,
    },
  };
}

function resolvePayrollStatus(status: CapRushPayrollStatus | undefined): CapRushPayrollStatus {
  if (status === undefined) return 'under-cap';
  if (status === 'illegal') {
    throw new FullCourtSetupError('invalid-lineup', 'full court payroll exceeds the hard limit');
  }
  return status;
}

/**
 * Adapts persisted Cap Rush spin-style receipts into a typed Full Court Roulette
 * team attachment. Matches targets by pinned `playerVersionId` so rotating or
 * reordering the depth chart never shifts the spin target or effective profile.
 */
export function adaptCapRushSpinsToFullCourt(
  input: AdaptCapRushSpinsToFullCourtInput,
): FullCourtRouletteTeamInput {
  const byVersionId = new Map<string, SimulationPlayer>();
  for (const player of input.roster) {
    if (player.playerVersionId !== undefined) {
      byVersionId.set(player.playerVersionId, player);
    }
  }
  const sourceByVersionId = new Map<string, SimulationPlayer | CapRushSourcePlayer>();
  for (const source of input.sourceRoster ?? []) {
    if (source.playerVersionId !== undefined) {
      sourceByVersionId.set(source.playerVersionId, source);
    }
  }
  const seenPlayers = new Set<string>();
  const seenExclusive = new Set<HavocMutationId>();
  const attachments: FullCourtRoulettePlayerAttachment[] = [];

  for (const receipt of input.receipts) {
    const player = byVersionId.get(receipt.target.playerVersionId);
    if (player === undefined) {
      throw new FullCourtSetupError(
        'unknown-player',
        `full court roulette spin targets unknown player version ${receipt.target.playerVersionId}`,
      );
    }
    if (receipt.target.playerId !== undefined && receipt.target.playerId !== player.playerId) {
      throw new FullCourtSetupError(
        'invalid-lineup',
        `full court roulette spin target ${receipt.target.playerVersionId} does not belong to ${receipt.target.playerId}`,
      );
    }
    if (seenPlayers.has(player.playerId)) {
      throw new FullCourtSetupError(
        'invalid-lineup',
        `full court roulette player ${player.playerId} already has a mutation selection`,
      );
    }
    seenPlayers.add(player.playerId);

    const slot = positionSchema.parse(receipt.target.slot);
    const mutationPackage = havocMutationPackageSchema.parse([
      receipt.entry,
      ...(receipt.additionalEntries ?? []),
    ]);
    if (mutationPackage.length === 0) {
      throw new FullCourtSetupError(
        'invalid-lineup',
        `full court roulette selection for ${player.playerId} has no mutations`,
      );
    }
    assertSupportedFullCourtRouletteMutations(mutationPackage.map((entry) => entry.mutationId));
    for (const entry of mutationPackage) {
      if (!TEAM_EXCLUSIVE_MUTATIONS.has(entry.mutationId)) continue;
      if (seenExclusive.has(entry.mutationId)) {
        throw new FullCourtSetupError(
          'invalid-lineup',
          `full court roulette team-exclusive mutation ${entry.mutationId} cannot appear twice`,
        );
      }
      seenExclusive.add(entry.mutationId);
    }

    const sourcePlayer = sourceByVersionId.get(receipt.target.playerVersionId);
    attachments.push({
      playerId: player.playerId,
      playerVersionId: receipt.target.playerVersionId,
      slot,
      mutationPackage,
      ...(sourcePlayer !== undefined ? { sourcePlayer } : {}),
      ...(receipt.effective !== undefined ? { effectiveProfile: receipt.effective } : {}),
    });
  }

  return {
    ...(input.payrollStatus !== undefined ? { payrollStatus: input.payrollStatus } : {}),
    attachments,
  };
}

/**
 * Validates and resolves a Full Court team's Roulette attachments into
 * effective Tier-1+apron `SimulationPlayer` profiles while preserving raw
 * `sourcePlayer` profiles for `body-snatcher` and dynamic Tier-3 effects.
 */
export function resolveFullCourtRouletteTeam(
  team: FullCourtTeamGameInput,
): ResolvedFullCourtRouletteTeam {
  const payrollStatus = resolvePayrollStatus(team.roulette?.payrollStatus);
  const attachments = team.roulette?.attachments ?? [];
  const rosterById = new Map(team.roster.map((player) => [player.playerId, player]));
  const seenPlayers = new Set<string>();
  const seenExclusive = new Set<HavocMutationId>();
  const attachmentsByPlayerId = new Map<string, ResolvedFullCourtRouletteAttachment>();

  for (const attachment of attachments) {
    if (seenPlayers.has(attachment.playerId)) {
      throw new FullCourtSetupError(
        'invalid-lineup',
        `full court roulette repeats player ${attachment.playerId}`,
      );
    }
    seenPlayers.add(attachment.playerId);

    const rosterPlayer = rosterById.get(attachment.playerId);
    if (rosterPlayer === undefined) {
      throw new FullCourtSetupError(
        'unknown-player',
        `full court roulette names ${attachment.playerId}, which is not on ${team.teamId}`,
      );
    }
    if (rosterPlayer.playerVersionId !== attachment.playerVersionId) {
      throw new FullCourtSetupError(
        'invalid-lineup',
        `full court roulette pinned version ${attachment.playerVersionId} does not match ${attachment.playerId}`,
      );
    }

    const slot = positionSchema.parse(attachment.slot);
    const mutationPackage = havocMutationPackageSchema.parse(attachment.mutationPackage);
    if (mutationPackage.length === 0) {
      throw new FullCourtSetupError(
        'invalid-lineup',
        `full court roulette selection for ${attachment.playerId} cannot be empty`,
      );
    }
    assertSupportedFullCourtRouletteMutations(mutationPackage.map((entry) => entry.mutationId));
    for (const entry of mutationPackage) {
      if (!TEAM_EXCLUSIVE_MUTATIONS.has(entry.mutationId)) continue;
      if (seenExclusive.has(entry.mutationId)) {
        throw new FullCourtSetupError(
          'invalid-lineup',
          `full court roulette team-exclusive mutation ${entry.mutationId} appears more than once on ${team.teamId}`,
        );
      }
      seenExclusive.add(entry.mutationId);
    }

    const sourcePlayer = simulationPlayerFromSource(rosterPlayer, attachment.sourcePlayer);
    const mutatedProfile =
      attachment.effectiveProfile !== undefined
        ? havocEffectiveProfileSchema.parse(attachment.effectiveProfile)
        : applyHavocMutationPackage(havocSourceFromSimulation(sourcePlayer), mutationPackage, {
            slot,
          });
    const basePlayer: SimulationPlayer = {
      ...sourcePlayer,
      heightInches: mutatedProfile.physical.heightInches,
      ratings: fullCourtEffectiveRatings(mutatedProfile.ratings, payrollStatus),
      tendencies: { ...mutatedProfile.tendencies },
    };
    const mutationOrder = mutationPackage.map((entry) => entry.mutationId);
    attachmentsByPlayerId.set(attachment.playerId, {
      playerId: attachment.playerId,
      playerVersionId: attachment.playerVersionId,
      slot,
      participantKey: attachment.participantKey ?? attachment.playerVersionId,
      sourcePlayer,
      basePlayer,
      physical: mutatedProfile.physical,
      authoritativeChannels: new Set(mutatedProfile.authoritativeChannels),
      mutations: new Set(mutationOrder),
      mutationOrder,
    });
  }

  const roster = team.roster.map(
    (player) => attachmentsByPlayerId.get(player.playerId)?.basePlayer ?? player,
  );
  return { payrollStatus, roster, attachmentsByPlayerId };
}

/**
 * Returns a copy of `team` with Tier-1+apron mutation profiles applied to
 * `roster` and pinned `sourcePlayer` + `effectiveProfile` metadata stored on
 * `roulette`, so passing it to `resolveRotationPlan` or `runFullCourtGame` is
 * idempotent.
 */
export function applyFullCourtRouletteMutations(
  team: FullCourtTeamGameInput,
  roulette: FullCourtRouletteTeamInput,
): FullCourtTeamGameInput {
  const resolved = resolveFullCourtRouletteTeam({ ...team, roulette });
  return {
    ...team,
    roster: [...resolved.roster],
    roulette: {
      payrollStatus: resolved.payrollStatus,
      attachments: roulette.attachments.map((attachment) => {
        const entry = resolved.attachmentsByPlayerId.get(attachment.playerId);
        if (entry === undefined) return attachment;
        return {
          ...attachment,
          sourcePlayer: entry.sourcePlayer,
          effectiveProfile: attachment.effectiveProfile ?? {
            ratings: applyHavocMutationPackage(
              havocSourceFromSimulation(entry.sourcePlayer),
              attachment.mutationPackage,
              { slot: entry.slot },
            ).ratings,
            tendencies: entry.basePlayer.tendencies,
            physical: entry.physical,
            authoritativeChannels: [...entry.authoritativeChannels],
          },
        };
      }),
    },
  };
}
