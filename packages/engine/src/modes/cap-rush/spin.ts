import type {
  CapRushDraftPick,
  CapRushSourcePlayer,
  CapRushSpinPurchaseId,
  CapRushSpinReceipt,
  CapRushSpinTarget,
  HavocMutationEntry,
  HavocMutationId,
  HavocSourcePlayer,
  HavocTier,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CAP_LINE_DOLLARS,
  CAP_RUSH_SPIN_PURCHASES,
  canonicalJson,
  capRushAdditionalSpinSeed,
  capRushSpinMutationSeed,
  capRushSpinPhysicalSeed,
  capRushSpinReceiptSchema,
  capRushSpinSpecialistSeed,
  capRushSpinTierSeed,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { createRng, type Rng } from '../../sim/rng.ts';
import { HAVOC_MUTATION_DEFINITIONS } from '../havoc/mutations.ts';
import { materializeHavocBundle } from '../havoc/offers.ts';
import { applyHavocMutationPackage } from '../havoc/transform.ts';

export const CAP_RUSH_SPIN_RECEIPT_DIGEST_PREFIX = 'cap-rush-spin-receipt-v1';

export interface CapRushSpinEligibility {
  readonly eligible: boolean;
  readonly payrollDollars: number;
  readonly priceDollars: number;
  readonly maxEligiblePayrollDollars: number;
}

export function capRushPayrollDollars(
  picks: readonly { readonly card: { readonly salaryDollars: number } }[],
): number {
  return picks.reduce((total, pick) => total + pick.card.salaryDollars, 0);
}

export function capRushSpinEligibility(
  payrollDollars: number,
  purchase: CapRushSpinPurchaseId,
): CapRushSpinEligibility {
  const { priceDollars, maxEligiblePayrollDollars } = CAP_RUSH_SPIN_PURCHASES[purchase];
  return {
    eligible: payrollDollars <= maxEligiblePayrollDollars,
    payrollDollars,
    priceDollars,
    maxEligiblePayrollDollars,
  };
}

export function capRushSpinDefinitionsForTier(tier: HavocTier): readonly HavocMutationId[] {
  return HAVOC_MUTATION_DEFINITIONS.filter((definition) => definition.tier === tier)
    .map((definition) => definition.mutationId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function drawCapRushSpinTier(rng: Rng, purchase: CapRushSpinPurchaseId): HavocTier {
  const odds = CAP_RUSH_SPIN_PURCHASES[purchase].tierOdds;
  const roll = rng.next();
  if (roll < odds[1]) return 1;
  if (roll < odds[1] + odds[2]) return 2;
  return 3;
}

export function capRushSpinTargetOf(pick: CapRushDraftPick): CapRushSpinTarget {
  return {
    pickOrdinal: pick.pickOrdinal,
    cardId: pick.card.cardId,
    slot: pick.slot,
    playerVersionId: pick.card.source.playerVersionId,
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

export function capRushSpinReceiptDigest(
  receipt: Omit<CapRushSpinReceipt, 'receiptDigest'>,
): string {
  return seasonDigestHex(`${CAP_RUSH_SPIN_RECEIPT_DIGEST_PREFIX}\u0000${canonicalJson(receipt)}`);
}

export interface CapRushSpinDrawInput {
  readonly runSeed: Seed;
  readonly purchase: CapRushSpinPurchaseId;
  readonly spinOrdinal?: number;
  readonly payrollDollars: number;
  readonly pick: CapRushDraftPick;
  readonly rngFactory?: (seed: string) => Rng;
}

function materializeSingleDefinition(
  tier: HavocTier,
  rngFactory: (seed: string) => Rng,
  runSeed: Seed,
): HavocMutationEntry {
  const definitions = capRushSpinDefinitionsForTier(tier);
  if (definitions.length === 0) {
    throw new Error(`cap rush spin has no mutation definitions for tier ${String(tier)}`);
  }
  const mutationId = rngFactory(capRushSpinMutationSeed(runSeed)).pick([...definitions]);
  const [entry] = materializeHavocBundle(
    { tier, mutationIds: [mutationId] },
    rngFactory(capRushSpinPhysicalSeed(runSeed)),
    rngFactory(capRushSpinSpecialistSeed(runSeed)),
    HAVOC_MUTATION_DEFINITIONS,
  );
  if (entry === undefined) {
    throw new Error(`cap rush spin could not materialize mutation ${mutationId}`);
  }
  return entry;
}

export function buildCapRushSpinReceipt(input: CapRushSpinDrawInput): CapRushSpinReceipt {
  const rngFactory = input.rngFactory ?? createRng;
  const runSeed = input.spinOrdinal
    ? capRushAdditionalSpinSeed(input.runSeed, input.spinOrdinal)
    : input.runSeed;
  const eligibility = capRushSpinEligibility(input.payrollDollars, input.purchase);
  if (!eligibility.eligible) {
    throw new Error(
      `cap rush ${input.purchase} spin needs payroll at or below $${String(CAP_RUSH_CAP_LINE_DOLLARS - eligibility.priceDollars)} (got $${String(input.payrollDollars)})`,
    );
  }
  const tier = drawCapRushSpinTier(rngFactory(capRushSpinTierSeed(runSeed)), input.purchase);
  const entry = materializeSingleDefinition(tier, rngFactory, runSeed);
  const effective = applyHavocMutationPackage(havocSourceOf(input.pick.card.source), [entry], {
    slot: input.pick.slot,
  });
  const payload: Omit<CapRushSpinReceipt, 'receiptDigest'> = {
    purchase: input.purchase,
    priceDollars: eligibility.priceDollars,
    payrollDollars: input.payrollDollars,
    tier,
    target: capRushSpinTargetOf(input.pick),
    entry,
    effective,
  };
  return capRushSpinReceiptSchema.parse({
    ...payload,
    receiptDigest: capRushSpinReceiptDigest(payload),
  });
}
