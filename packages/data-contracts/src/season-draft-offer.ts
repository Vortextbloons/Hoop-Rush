import { z } from 'zod';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_DRAFT_OFFER_SIZE } from './season-versions.ts';

export const seasonDraftOfferCardSchema = z.object({
  playerVersionId: playerVersionIdSchema,

  selectable: z.boolean(),

  coverageReason: z.string().min(1).max(256).nullable(),
});
export type SeasonDraftOfferCard = z.infer<typeof seasonDraftOfferCardSchema>;

export const seasonDraftOfferSchema = z
  .object({
    participantId: z.string().min(1).max(64),
    round: z.number().int().min(1).max(10),
    pickOrdinal: z.number().int().min(1).max(10),

    seedPath: z.array(z.string()).min(1),
    cards: z.array(seasonDraftOfferCardSchema).length(SEASON_DRAFT_OFFER_SIZE),
  })
  .superRefine((offer, ctx) => {
    if (new Set(offer.cards.map((card) => card.playerVersionId)).size !== offer.cards.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'offer cards must be distinct player version ids',
      });
    }
    for (const card of offer.cards) {
      if (card.selectable && card.coverageReason !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'selectable cards must have a null coverage reason',
        });
      }
      if (!card.selectable && card.coverageReason === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'disabled cards must carry a coverage reason',
        });
      }
    }
  });
export type SeasonDraftOffer = z.infer<typeof seasonDraftOfferSchema>;
