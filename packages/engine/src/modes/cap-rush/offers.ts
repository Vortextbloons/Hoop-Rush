import type {
  CapRushBucket,
  CapRushCard,
  CapRushDraftPick,
  CapRushOffer,
  CapRushSourcePlayer,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_OFFER_RECIPE,
  CAP_RUSH_OFFER_SIZE,
  canonicalJson,
  capRushCardSchema,
  capRushOfferSchema,
  capRushOfferBucketSeed,
  capRushOfferShuffleSeed,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { createRng, shuffle, type Rng } from '../../sim/rng.ts';
import type { CapRushCatalogIndex } from './catalog.ts';
import { capRushSalaryDollars } from './salary.ts';
import { CapRushCatalogCoverageError, CapRushGenerationError } from './errors.ts';
import { capRushOfferLegalCardIds } from './feasibility.ts';

export const CAP_RUSH_MAX_GENERATION_ATTEMPTS = 128;

const BUCKET_RULES = new Map(CAP_RUSH_OFFER_RECIPE.map((rule) => [rule.bucket, rule]));

export function capRushOfferRecipeBuckets(): CapRushBucket[] {
  return CAP_RUSH_OFFER_RECIPE.flatMap((rule) =>
    Array<CapRushBucket>(rule.count).fill(rule.bucket),
  );
}

class CapRushOfferAttemptFailed extends Error {}

interface PreparedCard {
  readonly bucket: CapRushBucket;
  readonly player: CapRushSourcePlayer;
}

interface CardOrigin {
  readonly runSeed: Seed;
  readonly round: number;
  readonly slot: Position;
  readonly offerRevision: number;
  readonly attempt: number;
  readonly cardIndex: number;
  readonly prepared: PreparedCard;
}

function eligiblePeople(
  index: CapRushCatalogIndex,
  slot: Position,
  bucket: CapRushBucket,
  excludedPlayerIds: ReadonlySet<string>,
): CapRushSourcePlayer[] {
  const rule = BUCKET_RULES.get(bucket);
  if (rule === undefined) throw new Error(`cap rush offer has no rule for bucket ${bucket}`);
  const versions = (index.bySlot.get(slot) ?? []).filter(
    (player) =>
      player.originalOverall >= rule.minOverall &&
      player.originalOverall <= rule.maxOverall &&
      !excludedPlayerIds.has(player.playerId),
  );
  const seen = new Set<string>();
  const people: CapRushSourcePlayer[] = [];
  for (const version of versions) {
    if (seen.has(version.playerId)) continue;
    seen.add(version.playerId);
    people.push(version);
  }
  return people;
}

function versionsInBucket(
  index: CapRushCatalogIndex,
  playerId: string,
  slot: Position,
  bucket: CapRushBucket,
): readonly CapRushSourcePlayer[] {
  const rule = BUCKET_RULES.get(bucket);
  if (rule === undefined) throw new Error(`cap rush offer has no rule for bucket ${bucket}`);
  return (index.byPlayerId.get(playerId) ?? []).filter(
    (player) =>
      player.positions.includes(slot) &&
      player.originalOverall >= rule.minOverall &&
      player.originalOverall <= rule.maxOverall,
  );
}

function prepareCards(input: {
  readonly index: CapRushCatalogIndex;
  readonly runSeed: Seed;
  readonly round: number;
  readonly slot: Position;
  readonly offerRevision: number;
  readonly attempt: number;
  readonly buckets: readonly CapRushBucket[];
  readonly excludedPlayerIds: ReadonlySet<string>;
  readonly rngFactory: (seed: string) => Rng;
}): PreparedCard[] {
  const prepared: PreparedCard[] = [];
  const chosen = new Set(input.excludedPlayerIds);
  for (const bucket of input.buckets) {
    const rng = input.rngFactory(
      capRushOfferBucketSeed(
        input.runSeed,
        input.round,
        input.slot,
        input.offerRevision,
        bucket,
        input.attempt,
      ),
    );
    const candidates = eligiblePeople(input.index, input.slot, bucket, chosen);
    if (candidates.length === 0) {
      const available = eligiblePeople(input.index, input.slot, bucket, input.excludedPlayerIds);
      if (available.length === 0) {
        throw new CapRushCatalogCoverageError(
          input.slot,
          `no available player in the ${bucket} band`,
        );
      }
      throw new CapRushOfferAttemptFailed(`the ${bucket} band has no distinct available player`);
    }
    const person = rng.pick(candidates);
    const versions = versionsInBucket(input.index, person.playerId, input.slot, bucket);
    if (versions.length === 0) {
      throw new CapRushOfferAttemptFailed(`player ${person.playerId} has no ${bucket} version`);
    }
    prepared.push({ bucket, player: rng.pick(versions) });
    chosen.add(person.playerId);
  }
  return prepared;
}

function cardIdOf(origin: CardOrigin): string {
  return `crc-${seasonDigestHex(
    canonicalJson({
      runSeed: origin.runSeed,
      round: origin.round,
      slot: origin.slot,
      offerRevision: origin.offerRevision,
      attempt: origin.attempt,
      cardIndex: origin.cardIndex,
      bucket: origin.prepared.bucket,
      playerVersionId: origin.prepared.player.playerVersionId,
    }),
  )}`;
}

function buildCard(origin: CardOrigin, offerId: string): CapRushCard {
  return capRushCardSchema.parse({
    cardId: cardIdOf(origin),
    offerId,
    cardIndex: origin.cardIndex,
    slot: origin.slot,
    bucket: origin.prepared.bucket,
    source: origin.prepared.player,
    salaryDollars: capRushSalaryDollars(origin.prepared.player.originalOverall),
  });
}

function offerIdOf(input: {
  readonly runSeed: Seed;
  readonly round: number;
  readonly slot: Position;
  readonly offerRevision: number;
  readonly attempt: number;
  readonly cardIds: readonly string[];
}): string {
  return `cro-${seasonDigestHex(
    canonicalJson({
      runSeed: input.runSeed,
      round: input.round,
      slot: input.slot,
      offerRevision: input.offerRevision,
      attempt: input.attempt,
      cardIds: input.cardIds,
    }),
  )}`;
}

export interface CapRushOfferInput {
  readonly index: CapRushCatalogIndex;
  readonly runSeed: Seed;
  readonly round: number;
  readonly slot: Position;
  readonly offerRevision: number;
  readonly picks: readonly CapRushDraftPick[];
  readonly rngFactory?: (seed: string) => Rng;
}

function hasLegalSigning(input: CapRushOfferInput, cards: readonly CapRushCard[]): boolean {
  return capRushOfferLegalCardIds({ picks: input.picks }, input.index, cards).length > 0;
}

function shuffledOffer(input: CapRushOfferInput, attempt: number): CapRushOffer | null {
  const signed = new Set(input.picks.map((pick) => pick.card.source.playerId));
  const rngFactory = input.rngFactory ?? createRng;
  let prepared: PreparedCard[];
  try {
    prepared = prepareCards({
      index: input.index,
      runSeed: input.runSeed,
      round: input.round,
      slot: input.slot,
      offerRevision: input.offerRevision,
      attempt,
      buckets: capRushOfferRecipeBuckets(),
      excludedPlayerIds: signed,
      rngFactory,
    });
  } catch (error) {
    if (error instanceof CapRushOfferAttemptFailed) return null;
    throw error;
  }
  const shuffled = shuffle(
    prepared,
    rngFactory(
      capRushOfferShuffleSeed(input.runSeed, input.round, input.slot, input.offerRevision, attempt),
    ),
  );
  const origins: CardOrigin[] = shuffled.map((preparedCard, cardIndex) => ({
    runSeed: input.runSeed,
    round: input.round,
    slot: input.slot,
    offerRevision: input.offerRevision,
    attempt,
    cardIndex,
    prepared: preparedCard,
  }));
  const offerId = offerIdOf({
    runSeed: input.runSeed,
    round: input.round,
    slot: input.slot,
    offerRevision: input.offerRevision,
    attempt,
    cardIds: origins.map(cardIdOf),
  });
  const cards = origins.map((origin) => buildCard(origin, offerId));
  if (!hasLegalSigning(input, cards)) return null;
  return capRushOfferSchema.parse({
    offerId,
    offerRevision: input.offerRevision,
    round: input.round,
    slot: input.slot,
    cards,
  });
}

export function generateCapRushOffer(input: CapRushOfferInput): CapRushOffer {
  if (!Number.isInteger(input.round) || input.round < 1 || input.round > 5) {
    throw new Error(`cap rush draft round must be an integer in 1..5 (got ${String(input.round)})`);
  }
  if (input.picks.some((pick) => pick.slot === input.slot)) {
    throw new Error(`cap rush offer cannot target the already filled ${input.slot} slot`);
  }
  for (let attempt = 0; attempt < CAP_RUSH_MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const offer = shuffledOffer(input, attempt);
    if (offer !== null) return offer;
  }
  throw new CapRushGenerationError(
    input.round,
    input.slot,
    `no attempt satisfied the recipe and legal-signing guarantee after ${String(CAP_RUSH_MAX_GENERATION_ATTEMPTS)} attempts`,
  );
}

export interface CapRushReplacementOfferInput extends CapRushOfferInput {
  readonly protectedCard: CapRushCard;
  readonly discardedPlayerIds: readonly string[];
}

function replacementOffer(
  input: CapRushReplacementOfferInput,
  recipe: readonly CapRushBucket[],
  attempt: number,
): CapRushOffer | null {
  const { protectedCard } = input;
  const excluded = new Set<string>(input.picks.map((pick) => pick.card.source.playerId));
  excluded.add(protectedCard.source.playerId);
  for (const playerId of input.discardedPlayerIds) excluded.add(playerId);
  const rngFactory = input.rngFactory ?? createRng;
  let prepared: PreparedCard[];
  try {
    prepared = prepareCards({
      index: input.index,
      runSeed: input.runSeed,
      round: input.round,
      slot: input.slot,
      offerRevision: input.offerRevision,
      attempt,
      buckets: recipe,
      excludedPlayerIds: excluded,
      rngFactory,
    });
  } catch (error) {
    if (error instanceof CapRushOfferAttemptFailed) return null;
    throw error;
  }
  const cardIndexes = Array.from({ length: CAP_RUSH_OFFER_SIZE }, (_, index) => index).filter(
    (index) => index !== protectedCard.cardIndex,
  );
  const origins: CardOrigin[] = cardIndexes.map((cardIndex, offset) => {
    const preparedCard = prepared[offset];
    if (preparedCard === undefined) {
      throw new Error('cap rush replacement assembly underflow');
    }
    return {
      runSeed: input.runSeed,
      round: input.round,
      slot: input.slot,
      offerRevision: input.offerRevision,
      attempt,
      cardIndex,
      prepared: preparedCard,
    };
  });
  const offerId = offerIdOf({
    runSeed: input.runSeed,
    round: input.round,
    slot: input.slot,
    offerRevision: input.offerRevision,
    attempt,
    cardIds: origins.map(cardIdOf),
  });
  const replaced = new Map(origins.map((origin) => [origin.cardIndex, buildCard(origin, offerId)]));
  const cards: CapRushCard[] = [];
  for (let cardIndex = 0; cardIndex < CAP_RUSH_OFFER_SIZE; cardIndex += 1) {
    const card =
      cardIndex === protectedCard.cardIndex
        ? { ...protectedCard, offerId }
        : replaced.get(cardIndex);
    if (card === undefined) throw new Error('cap rush replacement assembly underflow');
    cards.push(card);
  }
  if (!hasLegalSigning(input, cards)) return null;
  return capRushOfferSchema.parse({
    offerId,
    offerRevision: input.offerRevision,
    round: input.round,
    slot: input.slot,
    cards,
  });
}

export function generateCapRushReplacementOffer(input: CapRushReplacementOfferInput): CapRushOffer {
  const { protectedCard } = input;
  if (protectedCard.slot !== input.slot) {
    throw new Error('cap rush protected card does not belong to the offer slot');
  }
  if (input.picks.some((pick) => pick.slot === input.slot)) {
    throw new Error(`cap rush offer cannot target the already filled ${input.slot} slot`);
  }
  const recipe = capRushOfferRecipeBuckets();
  const protectedIndex = recipe.indexOf(protectedCard.bucket);
  if (protectedIndex < 0) {
    throw new Error('cap rush protected card has no recipe bucket');
  }
  recipe.splice(protectedIndex, 1);
  for (let attempt = 0; attempt < CAP_RUSH_MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const offer = replacementOffer(input, recipe, attempt);
    if (offer !== null) return offer;
  }
  throw new CapRushGenerationError(
    input.round,
    input.slot,
    `no replacement attempt satisfied the recipe and legal-signing guarantee after ${String(CAP_RUSH_MAX_GENERATION_ATTEMPTS)} attempts`,
  );
}
