import type {
  CapRushBucket,
  CapRushSourcePlayer,
  FullCourtDraftState,
  FullCourtOfferCard,
  FullCourtRoundOffer,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_OFFER_RECIPE,
  fullCourtRoundOfferSchema,
  havocInstanceSeed,
} from '@hoop-rush/data-contracts';
import { createRng } from '../../sim/rng.ts';
import { compareStrings } from '../../domain/math.ts';
import { fullCourtSalaryDollarsOf, type FullCourtCatalogIndex } from './draft-catalog.ts';
import { fullCourtAssessPick } from './draft-economy.ts';

const OFFER_SEED_PURPOSE = 'full-court-offer-v1';
const MAX_OFFER_ATTEMPTS = 64;

function compareOfferCards(left: CapRushSourcePlayer, right: CapRushSourcePlayer): number {
  return (
    right.originalOverall - left.originalOverall ||
    compareStrings(left.displayName, right.displayName) ||
    compareStrings(left.seasonKey, right.seasonKey) ||
    compareStrings(left.playerVersionId, right.playerVersionId)
  );
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
 * Draws a positionless 10-card offer for the current Full Court round using Cap Rush's
 * overall-tier recipe (`elite`, `star`, `strong`, `rotation`, `budget`, `wildcard`),
 * sorted by overall descending.
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

    for (const rule of CAP_RUSH_OFFER_RECIPE) {
      for (let slot = 0; slot < rule.count; slot += 1) {
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
    }

    if (drawn.length === 0) return undefined;
    const cards = [...drawn]
      .sort((left, right) => compareOfferCards(left.player, right.player))
      .map((entry, cardIndex): FullCourtOfferCard => ({
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
