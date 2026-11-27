import type {
  CapRushDraftPick,
  CapRushSpinPurchaseId,
  CapRushSpinReceipt,
  CapRushSpinTarget,
  HavocMutationEntry,
  HavocMutationId,
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
import { enumerateHavocBundles } from '../havoc/compatibility.ts';
import { materializeHavocBundle } from '../havoc/offers.ts';
import { applyHavocMutationPackage } from '../havoc/transform.ts';
import { capRushHavocSourceOf } from './effective-profile.ts';

export const CAP_RUSH_SPIN_RECEIPT_DIGEST_PREFIX = 'cap-rush-spin-receipt-v1';

export class CapRushSpinDrawUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapRushSpinDrawUnavailableError';
  }
}

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
  mutationId: HavocMutationId,
  rngFactory: (seed: string) => Rng,
  runSeed: Seed,
): HavocMutationEntry {
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

export function drawCapRushSpin(
  input: Pick<CapRushSpinDrawInput, 'runSeed' | 'purchase' | 'spinOrdinal' | 'rngFactory'> & {
    /**
     * Optional caller-owned exclusions (for example Full Court's already-owned
     * team-exclusive mutations). The draw is unchanged when the first pick is legal;
     * only an illegal pick falls back to a deterministic second pick at the same tier.
     */
    readonly excludedMutationIds?: ReadonlySet<HavocMutationId>;
  },
): { tier: HavocTier; entries: HavocMutationEntry[] } {
  const rngFactory = input.rngFactory ?? createRng;
  const excluded = input.excludedMutationIds ?? new Set<HavocMutationId>();
  const runSeed = input.spinOrdinal
    ? capRushAdditionalSpinSeed(input.runSeed, input.spinOrdinal)
    : input.runSeed;
  const tier = drawCapRushSpinTier(rngFactory(capRushSpinTierSeed(runSeed)), input.purchase);
  const mutationRng = rngFactory(capRushSpinMutationSeed(runSeed));
  if (input.purchase === 'surge') {
    const bundles = enumerateHavocBundles(HAVOC_MUTATION_DEFINITIONS, tier);
    if (bundles.length === 0) {
      throw new CapRushSpinDrawUnavailableError(
        `no surge bundles are defined for tier ${String(tier)}`,
      );
    }
    let bundle = mutationRng.pick([...bundles]);
    if (bundle.mutationIds.some((mutationId) => excluded.has(mutationId))) {
      const legal = bundles.filter((candidate) =>
        candidate.mutationIds.every((mutationId) => !excluded.has(mutationId)),
      );
      if (legal.length === 0) {
        throw new CapRushSpinDrawUnavailableError(
          `no legal surge bundle remains at tier ${String(tier)}`,
        );
      }
      bundle = mutationRng.pick([...legal]);
    }
    return {
      tier,
      entries: materializeHavocBundle(
        bundle,
        rngFactory(capRushSpinPhysicalSeed(runSeed)),
        rngFactory(capRushSpinSpecialistSeed(runSeed)),
        HAVOC_MUTATION_DEFINITIONS,
      ),
    };
  }
  const definitions = capRushSpinDefinitionsForTier(tier);
  if (definitions.length === 0) {
    throw new CapRushSpinDrawUnavailableError(
      `no mutation definitions are defined for tier ${String(tier)}`,
    );
  }
  let mutationId = mutationRng.pick([...definitions]);
  if (excluded.has(mutationId)) {
    const legal = definitions.filter((candidate) => !excluded.has(candidate));
    if (legal.length === 0) {
      throw new CapRushSpinDrawUnavailableError(
        `no legal mutation remains at tier ${String(tier)}`,
      );
    }
    mutationId = mutationRng.pick([...legal]);
  }
  return {
    tier,
    entries: [materializeSingleDefinition(tier, mutationId, rngFactory, runSeed)],
  };
}

export function buildCapRushSpinReceipt(input: CapRushSpinDrawInput): CapRushSpinReceipt {
  const eligibility = capRushSpinEligibility(input.payrollDollars, input.purchase);
  if (!eligibility.eligible) {
    throw new Error(
      `cap rush ${input.purchase} spin needs payroll at or below $${String(CAP_RUSH_CAP_LINE_DOLLARS - eligibility.priceDollars)} (got $${String(input.payrollDollars)})`,
    );
  }
  const { tier, entries } = drawCapRushSpin(input);
  const entry = entries[0];
  if (entry === undefined) throw new Error('cap rush spin produced no mutations');
  const effective = applyHavocMutationPackage(
    capRushHavocSourceOf(input.pick.card.source),
    entries,
    { slot: input.pick.slot },
  );
  const payload: Omit<CapRushSpinReceipt, 'receiptDigest'> = {
    purchase: input.purchase,
    priceDollars: eligibility.priceDollars,
    payrollDollars: input.payrollDollars,
    tier,
    target: capRushSpinTargetOf(input.pick),
    entry,
    ...(entries.length > 1 ? { additionalEntries: entries.slice(1) } : {}),
    effective,
  };
  return capRushSpinReceiptSchema.parse({
    ...payload,
    receiptDigest: capRushSpinReceiptDigest(payload),
  });
}
