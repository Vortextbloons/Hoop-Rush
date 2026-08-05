import { z } from 'zod';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_DRAFT_OFFER_SIZE } from './season-versions.ts';

/**
 * M2.3.5 global eight-card draft offer contract (spec/2.0/03,
 * season-draft-v2). Each round draws exactly `SEASON_DRAFT_OFFER_SIZE`
 * distinct player-version cards from the complete catalog minus already-owned
 * exact versions. Three candidates are deterministically selected as
 * feasibility-safe (the 4/4/3 completion targets stay reachable); five more
 * candidates are sampled globally without filtering and stay visible but are
 * disabled when they would make a legal roster impossible.
 */

/** One card in an offer. */
export const seasonDraftOfferCardSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  /**
   * True when selecting this card keeps the participant's 4/4/3 completion
   * targets reachable with the remaining picks; false when it would make a
   * legal final roster impossible.
   */
  selectable: z.boolean(),
  /**
   * Stable human-readable reason shown beside disabled cards; null exactly
   * when the card is selectable.
   */
  coverageReason: z.string().min(1).max(256).nullable(),
});
export type SeasonDraftOfferCard = z.infer<typeof seasonDraftOfferCardSchema>;

/** One drawn offer for one participant's turn. */
export const seasonDraftOfferSchema = z
  .object({
    participantId: z.string().min(1).max(64),
    round: z.number().int().min(1).max(10),
    pickOrdinal: z.number().int().min(1).max(10),
    /**
     * Named seed keys under the `draft` namespace used to reproduce this
     * offer exactly from (root seed, state, offer). Persisted so reload and
     * CLI replay reproduce the board byte-for-byte.
     */
    seedPath: z.array(z.string()).min(1),
    cards: z.array(seasonDraftOfferCardSchema).length(SEASON_DRAFT_OFFER_SIZE),
  })
  .superRefine((offer, ctx) => {
    if (new Set(offer.cards.map((card) => card.playerVersionId)).size !== offer.cards.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'offer cards must be distinct player version ids',
      });
    }
    for (const card of offer.cards) {
      if (card.selectable && card.coverageReason !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'selectable cards must have a null coverage reason',
        });
      }
      if (!card.selectable && card.coverageReason === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'disabled cards must carry a coverage reason',
        });
      }
    }
  });
export type SeasonDraftOffer = z.infer<typeof seasonDraftOfferSchema>;
