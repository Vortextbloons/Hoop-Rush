import type {
  CapRushDraftPick,
  CapRushHighestPaidTarget,
  CapRushLockedInputs,
  CapRushLockedPick,
  CapRushPayrollStatus,
  CapRushScheduleEntry,
  CapRushSourcePlayer,
  CapRushSpinReceipt,
  CapRushVariant,
  CapRushVersionSet,
  EraSimulationProfile,
  HavocEffectiveProfile,
  HavocMutationPackage,
  HavocSourcePlayer,
  HavocTeamInput,
  OpponentBracket,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_SCHEMA_VERSION,
  POSITIONS,
  capRushLockedInputsSchema,
  havocEffectiveProfileSchema,
  havocInstanceIdSchema,
  havocInstanceSeed,
  havocTeamInputSchema,
} from '@hoop-rush/data-contracts';
import { applyHavocMutationPackage } from '../havoc/transform.ts';
import { buildHavocOpponentTeam, buildHavocSchedule } from '../havoc/opponents.ts';
import { capRushEffectiveRatings, capRushPayrollStatus } from './salary.ts';

export const CAP_RUSH_HUMAN_TEAM_ID = 'cap-rush-human';
export const CAP_RUSH_HUMAN_TEAM_NAME = 'Cap Rush Five';

export interface CapRushLockSources {
  readonly bracket: OpponentBracket;
  readonly profile: EraSimulationProfile;
}

export function capRushPayrollDollarsOf(picks: readonly CapRushDraftPick[]): number {
  return picks.reduce((total, pick) => total + pick.card.salaryDollars, 0);
}

export function capRushInstanceIdOf(
  runSeed: Seed,
  purpose: string,
  ...keys: readonly (string | number)[]
): string {
  return havocInstanceIdSchema.parse(`hvi-${havocInstanceSeed(runSeed, purpose, ...keys)}`);
}

export function capRushHighestPaidOf(
  picks: readonly CapRushDraftPick[],
  runSeed: Seed,
): CapRushHighestPaidTarget {
  const ordered = [...picks].sort((left, right) => {
    if (left.card.salaryDollars !== right.card.salaryDollars) {
      return right.card.salaryDollars - left.card.salaryDollars;
    }
    return POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot);
  });
  const highest = ordered[0];
  if (highest === undefined) {
    throw new Error('cap rush highest-paid target requires at least one pick');
  }
  return {
    pickOrdinal: highest.pickOrdinal,
    cardId: highest.card.cardId,
    slot: highest.slot,
    instanceId: capRushInstanceIdOf(runSeed, 'human-starter', highest.pickOrdinal),
  };
}

function havocSourceOf(player: CapRushSourcePlayer): HavocSourcePlayer {
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

function effectiveProfileOf(input: {
  readonly player: CapRushSourcePlayer;
  readonly slot: Position;
  readonly payrollStatus: CapRushPayrollStatus;
  readonly mutationPackage: HavocMutationPackage;
}): HavocEffectiveProfile {
  const mutated = applyHavocMutationPackage(havocSourceOf(input.player), input.mutationPackage, {
    slot: input.slot,
  });
  return havocEffectiveProfileSchema.parse({
    ...mutated,
    ratings: capRushEffectiveRatings(mutated.ratings, input.payrollStatus),
  });
}

export function buildCapRushHumanTeam(input: {
  readonly runSeed: Seed;
  readonly picks: readonly CapRushDraftPick[];
  readonly payrollStatus: CapRushPayrollStatus;
  readonly spin: CapRushSpinReceipt | null;
  readonly additionalSpins?: readonly CapRushSpinReceipt[] | undefined;
}): HavocTeamInput {
  if (input.picks.length !== POSITIONS.length) {
    throw new Error(
      `cap rush human team requires five locked picks (got ${String(input.picks.length)})`,
    );
  }
  const ordered = [...input.picks].sort(
    (left, right) => POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot),
  );
  const starters = ordered.map((pick) => {
    const receipt = [input.spin, ...(input.additionalSpins ?? [])].find(
      (spin) => spin?.target.cardId === pick.card.cardId,
    );
    const mutationPackage = receipt ? [receipt.entry] : [];
    return {
      instanceId: capRushInstanceIdOf(input.runSeed, 'human-starter', pick.pickOrdinal),
      kind: 'starter' as const,
      slot: pick.slot,
      ownerInstanceId: null,
      mutationPackage,
      source: havocSourceOf(pick.card.source),
      effective: effectiveProfileOf({
        player: pick.card.source,
        slot: pick.slot,
        payrollStatus: input.payrollStatus,
        mutationPackage,
      }),
    };
  });
  const replacements = ordered.map((pick, ordinal) => {
    const starter = starters[ordinal];
    if (starter === undefined) {
      throw new Error(`cap rush human team is missing starter ${String(ordinal)}`);
    }
    return {
      instanceId: capRushInstanceIdOf(input.runSeed, 'human-replacement', pick.pickOrdinal),
      kind: 'replacement' as const,
      slot: pick.slot,
      ownerInstanceId: starter.instanceId,
      mutationPackage: [],
      source: havocSourceOf(pick.card.source),
      effective: effectiveProfileOf({
        player: pick.card.source,
        slot: pick.slot,
        payrollStatus: input.payrollStatus,
        mutationPackage: [],
      }),
    };
  });
  return havocTeamInputSchema.parse({
    side: 'human',
    teamId: CAP_RUSH_HUMAN_TEAM_ID,
    displayName: CAP_RUSH_HUMAN_TEAM_NAME,
    starters,
    replacements,
    clones: [],
  });
}

export function buildCapRushSchedule(bracket: OpponentBracket): CapRushScheduleEntry[] {
  return buildHavocSchedule(bracket);
}

export function buildCapRushLockedInputs(input: {
  readonly runId: string;
  readonly runSeed: Seed;
  readonly variant: CapRushVariant;
  readonly versionSet: CapRushVersionSet;
  readonly catalog: CapRushLockedInputs['catalog'];
  readonly picks: readonly CapRushDraftPick[];
  readonly spin: CapRushSpinReceipt | null;
  readonly additionalSpins?: readonly CapRushSpinReceipt[] | undefined;
  readonly bracket: OpponentBracket;
  readonly profile: EraSimulationProfile;
}): CapRushLockedInputs {
  const payrollDollars = capRushPayrollDollarsOf(input.picks);
  const payrollStatus = capRushPayrollStatus(payrollDollars);
  if (payrollStatus === 'illegal') {
    throw new Error(`cap rush payroll $${String(payrollDollars)} exceeds the hard limit`);
  }
  const ordered = [...input.picks].sort((left, right) => left.pickOrdinal - right.pickOrdinal);
  const lockedPicks: CapRushLockedPick[] = ordered.map((pick) => ({
    pickOrdinal: pick.pickOrdinal,
    slot: pick.slot,
    cardId: pick.card.cardId,
    bucket: pick.card.bucket,
    playerId: pick.card.source.playerId,
    playerVersionId: pick.card.source.playerVersionId,
    salaryDollars: pick.card.salaryDollars,
  }));
  const human = buildCapRushHumanTeam({
    runSeed: input.runSeed,
    picks: input.picks,
    payrollStatus,
    spin: input.spin,
    additionalSpins: input.additionalSpins,
  });
  const schedule = buildCapRushSchedule(input.bracket);
  const opponents = input.bracket.opponents.map((opponent) => ({
    opponentId: opponent.opponentId,
    team: buildHavocOpponentTeam({
      runSeed: input.runSeed,
      opponent,
      profile: input.profile,
    }).team,
  }));
  return capRushLockedInputsSchema.parse({
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    runId: input.runId,
    runSeed: input.runSeed,
    variant: input.variant,
    versionSet: input.versionSet,
    profile: input.profile,
    catalog: input.catalog,
    picks: lockedPicks,
    payrollDollars,
    payrollStatus,
    target: capRushHighestPaidOf(input.picks, input.runSeed),
    spin: input.spin,
    ...(input.additionalSpins?.length ? { additionalSpins: input.additionalSpins } : {}),
    human,
    schedule,
    opponents,
  });
}
