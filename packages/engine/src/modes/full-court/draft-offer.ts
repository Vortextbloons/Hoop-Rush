import type {
  CapRushBucket,
  CapRushSourcePlayer,
  FullCourtDraftState,
  FullCourtOfferCard,
  FullCourtRoundOffer,
} from '@hoop-rush/data-contracts';
import { fullCourtRoundOfferSchema, havocInstanceSeed } from '@hoop-rush/data-contracts';
import { createRng, shuffle } from '../../sim/rng.ts';
import { fullCourtSalaryDollarsOf, type FullCourtCatalogIndex } from './draft-catalog.ts';
import { fullCourtAssessPick } from './draft-economy.ts';

const OFFER_SEED_PURPOSE = 'full-court-offer-v1';
const MAX_OFFER_ATTEMPTS = 64;
const ELITE_SLOT_CHANCE = 0.25;
const STAR_SLOT_CHANCE = 0.45;

interface OfferBucketRule {
  readonly bucket: CapRushBucket;
  readonly minOverall: number;
  readonly maxOverall: number;
}

const BUCKET_RULES: Readonly<Record<CapRushBucket, OfferBucketRule>> = {
  elite: { bucket: 'elite', minOverall: 95, maxOverall: 99 },
  star: { bucket: 'star', minOverall: 90, maxOverall: 99 },
  strong: { bucket: 'strong', minOverall: 80, maxOverall: 89 },
  rotation: { bucket: 'rotation', minOverall: 75, maxOverall: 79 },
  budget: { bucket: 'budget', minOverall: 60, maxOverall: 74 },
  wildcard: { bucket: 'wildcard', minOverall: 40, maxOverall: 99 },
};

function roundBucketRecipe(seed: string): readonly OfferBucketRule[] {
  const rng = createRng(seed);
  const topSlot1: CapRushBucket =
    rng.next() < ELITE_SLOT_CHANCE ? 'elite' : rng.next() < 0.5 ? 'strong' : 'rotation';
  const topSlot2: CapRushBucket =
    rng.next() < STAR_SLOT_CHANCE ? 'star' : rng.next() < 0.5 ? 'strong' : 'rotation';
  const buckets: readonly CapRushBucket[] = [
    topSlot1,
    topSlot2,
    'strong',
    'strong',
    'rotation',
    'budget',
    'budget',
    'wildcard',
  ];
  return buckets.map((bucket) => BUCKET_RULES[bucket]);
}

function drawBucketPlayer(input: {
  readonly candidates: readonly CapRushSourcePlayer[];
  readonly minOverall: number;
  readonly maxOverall: number;
  readonly excludedPlayerIds: ReadonlySet<string>;
  readonly seed: string;
}): CapRushSourcePlayer | null {
  const rng = createRng(input.seed);
  const inBand = input.candidates.filter(
    (player) =>
      !input.excludedPlayerIds.has(player.playerId) &&
      player.originalOverall >= input.minOverall &&
      player.originalOverall <= input.maxOverall,
  );
  const pool =
    inBand.length > 0
      ? inBand
      : input.candidates.filter((player) => !input.excludedPlayerIds.has(player.playerId));
  if (pool.length === 0) return null;
  const distinctIds = Array.from(new Set(pool.map((player) => player.playerId)));
  const pickedId = rng.pick(distinctIds);
  const versions = pool.filter((player) => player.playerId === pickedId);
  return rng.pick(versions);
}

/**
 * Draws a positionless 8-card offer for the current Full Court round with varied
 * per-round star odds and shuffled card order (like Cap Rush).
 */
export function drawFullCourtRoundOffer(input: {
  readonly index: FullCourtCatalogIndex;
  readonly state: Pick<
    FullCourtDraftState,
    'runSeed' | 'picks' | 'money' | 'spending' | 'stage' | 'pool'
  >;
  readonly round: number;
}): FullCourtRoundOffer | undefined {
  if (input.state.stage !== 'drafting') return undefined;
  const assessState = input.state as FullCourtDraftState;
  const excluded = new Set(input.state.picks.map((pick) => pick.player.playerId));
  const candidates = input.index.catalog.candidates;
  let fallbackCards: FullCourtOfferCard[] | undefined;

  for (let attempt = 0; attempt < MAX_OFFER_ATTEMPTS; attempt += 1) {
    const attemptExcluded = new Set(excluded);
    const drawn: { bucket: CapRushBucket; player: CapRushSourcePlayer }[] = [];
    const recipe = roundBucketRecipe(
      havocInstanceSeed(
        input.state.runSeed,
        OFFER_SEED_PURPOSE,
        `r${String(input.round)}-a${String(attempt)}-recipe`,
      ),
    );

    for (const [slot, rule] of recipe.entries()) {
      const seed = havocInstanceSeed(
        input.state.runSeed,
        OFFER_SEED_PURPOSE,
        `r${String(input.round)}-a${String(attempt)}-${rule.bucket}-${String(slot)}`,
      );
      const player = drawBucketPlayer({
        candidates,
        minOverall: rule.minOverall,
        maxOverall: rule.maxOverall,
        excludedPlayerIds: attemptExcluded,
        seed,
      });
      if (player === null) break;
      attemptExcluded.add(player.playerId);
      drawn.push({ bucket: rule.bucket, player });
    }

    if (drawn.length === 0) return undefined;
    const shuffled = shuffle(
      drawn,
      createRng(
        havocInstanceSeed(
          input.state.runSeed,
          OFFER_SEED_PURPOSE,
          `r${String(input.round)}-a${String(attempt)}-shuffle`,
        ),
      ),
    );
    const cards = shuffled.map((entry, cardIndex): FullCourtOfferCard => ({
      cardIndex,
      bucket: entry.bucket,
      player: entry.player,
      salaryDollars: fullCourtSalaryDollarsOf(entry.player),
    }));

    fallbackCards ??= cards;
    const hasLegalPick = cards.some(
      (card) =>
        fullCourtAssessPick({
          index: input.index,
          state: assessState,
          playerId: card.player.playerId,
          salaryDollars: card.salaryDollars,
        }).legal,
    );
    if (hasLegalPick) {
      return fullCourtRoundOfferSchema.parse({ round: input.round, cards });
    }
  }

  return fallbackCards === undefined
    ? undefined
    : fullCourtRoundOfferSchema.parse({ round: input.round, cards: fallbackCards });
}
