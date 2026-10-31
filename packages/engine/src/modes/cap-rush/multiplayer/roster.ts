import type {
  CapRushFranchiseAssignment,
  CapRushLockedPick,
  CapRushMultiplayerMarket,
  CapRushMultiplayerMarketPlayer,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerSeatLock,
  CapRushMultiplayerSigning,
  CapRushPayrollStatus,
  CapRushSourcePlayer,
  CapRushSpinReceipt,
  HavocEffectiveProfile,
  HavocMutationPackage,
  HavocSourcePlayer,
  HavocTeamInput,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  POSITIONS,
  havocEffectiveProfileSchema,
  havocInstanceIdSchema,
  havocInstanceSeed,
  havocTeamInputSchema,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { applyHavocMutationPackage } from '../../havoc/transform.ts';
import { capRushEffectiveRatings, capRushPayrollStatus } from '../salary.ts';
import { CapRushMultiplayerCompletionError } from './market.ts';

export function capRushMultiplayerInstanceIdOf(
  rootSeed: Seed,
  seat: CapRushMultiplayerSeatId,
  purpose: string,
  ...keys: readonly (string | number)[]
): string {
  return havocInstanceIdSchema.parse(
    `hvi-${havocInstanceSeed(rootSeed, `human-${seat}-${purpose}`, ...keys)}`,
  );
}

export function capRushMultiplayerCardId(marketDigest: string, playerId: string): string {
  return `crc-${seasonDigestHex(`${marketDigest}\u0000${playerId}`)}`;
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

function receiptTargets(
  spin: CapRushSpinReceipt | null,
  additionalSpins: readonly CapRushSpinReceipt[] | undefined,
): ReadonlyMap<string, CapRushSpinReceipt> {
  const map = new Map<string, CapRushSpinReceipt>();
  for (const receipt of [spin, ...(additionalSpins ?? [])]) {
    if (receipt === null) continue;
    map.set(receipt.target.cardId, receipt);
  }
  return map;
}

export function buildCapRushMultiplayerTeam(input: {
  readonly rootSeed: Seed;
  readonly seat: CapRushMultiplayerSeatId;
  readonly picks: readonly CapRushLockedPick[];
  readonly sources: ReadonlyMap<string, CapRushSourcePlayer>;
  readonly payrollStatus: CapRushPayrollStatus;
  readonly spin: CapRushSpinReceipt | null;
  readonly additionalSpins?: readonly CapRushSpinReceipt[] | undefined;
  readonly teamId: string;
  readonly displayName: string;
}): HavocTeamInput {
  if (input.picks.length !== POSITIONS.length) {
    throw new Error(
      `cap rush multiplayer: a seat needs five picks (got ${String(input.picks.length)})`,
    );
  }
  const ordered = [...input.picks].sort(
    (left, right) => POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot),
  );
  const receipts = receiptTargets(input.spin, input.additionalSpins);
  const starters = ordered.map((pick) => {
    const source = input.sources.get(pick.playerId);
    if (source === undefined) {
      throw new CapRushMultiplayerCompletionError(
        input.seat,
        `cap rush multiplayer: no source for ${pick.playerId}`,
      );
    }
    const receipt = receipts.get(pick.cardId);
    const mutationPackage = receipt ? [receipt.entry, ...(receipt.additionalEntries ?? [])] : [];
    return {
      instanceId: capRushMultiplayerInstanceIdOf(
        input.rootSeed,
        input.seat,
        'starter',
        pick.pickOrdinal,
      ),
      kind: 'starter' as const,
      slot: pick.slot,
      ownerInstanceId: null,
      mutationPackage,
      source: havocSourceOf(source),
      effective: effectiveProfileOf({
        player: source,
        slot: pick.slot,
        payrollStatus: input.payrollStatus,
        mutationPackage,
      }),
    };
  });
  const replacements = ordered.map((pick, ordinal) => {
    const starter = starters[ordinal];
    if (starter === undefined) {
      throw new Error(`cap rush multiplayer: missing starter ${String(ordinal)}`);
    }
    const source = input.sources.get(pick.playerId);
    if (source === undefined) {
      throw new CapRushMultiplayerCompletionError(
        input.seat,
        `cap rush multiplayer: no source for ${pick.playerId}`,
      );
    }
    return {
      instanceId: capRushMultiplayerInstanceIdOf(
        input.rootSeed,
        input.seat,
        'replacement',
        pick.pickOrdinal,
      ),
      kind: 'replacement' as const,
      slot: pick.slot,
      ownerInstanceId: starter.instanceId,
      mutationPackage: [],
      source: havocSourceOf(source),
      effective: effectiveProfileOf({
        player: source,
        slot: pick.slot,
        payrollStatus: input.payrollStatus,
        mutationPackage: [],
      }),
    };
  });
  return havocTeamInputSchema.parse({
    side: 'human',
    teamId: input.teamId,
    displayName: input.displayName,
    starters,
    replacements,
    clones: [],
  });
}

export function capRushMultiplayerPicksOf(
  market: CapRushMultiplayerMarket,
  signings: readonly CapRushMultiplayerSigning[],
  seat: CapRushMultiplayerSeatId,
): { readonly picks: CapRushLockedPick[]; readonly sources: Map<string, CapRushSourcePlayer> } {
  const picks: CapRushLockedPick[] = [];
  const sources = new Map<string, CapRushSourcePlayer>();
  for (const signing of signings.filter((entry) => entry.seat === seat)) {
    const player = market.players.find((entry) => entry.playerId === signing.playerId);
    if (player === undefined) {
      throw new CapRushMultiplayerCompletionError(
        seat,
        `cap rush multiplayer: market has no player ${signing.playerId}`,
      );
    }
    const pickOrdinal = POSITIONS.indexOf(signing.position);
    if (pickOrdinal < 0) {
      throw new Error(`cap rush multiplayer: invalid signing position ${signing.position}`);
    }
    picks.push({
      pickOrdinal,
      slot: signing.position,
      cardId: capRushMultiplayerCardId(market.digest, player.playerId),
      bucket: player.bucket,
      playerId: player.playerId,
      playerVersionId: player.playerVersionId,
      salaryDollars: signing.salaryDollars,
    });
    sources.set(player.playerId, player.source);
  }
  picks.sort((left, right) => left.pickOrdinal - right.pickOrdinal);
  return { picks, sources };
}

export function capRushMultiplayerHighestPaidOf(input: {
  readonly rootSeed: Seed;
  readonly seat: CapRushMultiplayerSeatId;
  readonly picks: readonly CapRushLockedPick[];
}): CapRushMultiplayerSeatLock['target'] {
  const ordered = [...input.picks].sort((left, right) => {
    if (left.salaryDollars !== right.salaryDollars) {
      return right.salaryDollars - left.salaryDollars;
    }
    return POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot);
  });
  const highest = ordered[0];
  if (highest === undefined) {
    throw new CapRushMultiplayerCompletionError(input.seat, 'no picks to target');
  }
  return {
    pickOrdinal: highest.pickOrdinal,
    cardId: highest.cardId,
    slot: highest.slot,
    instanceId: capRushMultiplayerInstanceIdOf(
      input.rootSeed,
      input.seat,
      'starter',
      highest.pickOrdinal,
    ),
  };
}

export function buildCapRushMultiplayerSeatLock(input: {
  readonly rootSeed: Seed;
  readonly seat: CapRushMultiplayerSeatId;
  readonly franchise: CapRushFranchiseAssignment;
  readonly market: CapRushMultiplayerMarket;
  readonly signings: readonly CapRushMultiplayerSigning[];
  readonly spin: CapRushSpinReceipt | null;
  readonly additionalSpins?: readonly CapRushSpinReceipt[] | undefined;
  readonly ready?: boolean;
}): CapRushMultiplayerSeatLock {
  const { picks, sources } = capRushMultiplayerPicksOf(input.market, input.signings, input.seat);
  if (picks.length !== POSITIONS.length) {
    throw new CapRushMultiplayerCompletionError(
      input.seat,
      `cap rush multiplayer: ${input.seat} has ${String(picks.length)} signings`,
    );
  }
  const payrollDollars = picks.reduce((total, pick) => total + pick.salaryDollars, 0);
  const payrollStatus = capRushPayrollStatus(payrollDollars);
  return {
    seat: input.seat,
    franchise: input.franchise,
    picks,
    team: buildCapRushMultiplayerTeam({
      rootSeed: input.rootSeed,
      seat: input.seat,
      picks,
      sources,
      payrollStatus,
      spin: input.spin,
      additionalSpins: input.additionalSpins,
      teamId: input.franchise.franchiseId,
      displayName: input.franchise.displayName,
    }),
    payrollDollars,
    payrollStatus,
    target: capRushMultiplayerHighestPaidOf({
      rootSeed: input.rootSeed,
      seat: input.seat,
      picks,
    }),
    spin: input.spin,
    ...(input.additionalSpins?.length ? { additionalSpins: [...input.additionalSpins] } : {}),
    ready: input.ready ?? false,
  };
}

export function capRushMultiplayerMarketPlayerSource(
  market: CapRushMultiplayerMarket,
  playerId: string,
): CapRushMultiplayerMarketPlayer {
  const player = market.players.find((entry) => entry.playerId === playerId);
  if (player === undefined) {
    throw new CapRushMultiplayerCompletionError(null, `market has no player ${playerId}`);
  }
  return player;
}
