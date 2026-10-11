import { z } from 'zod';
import { contentHashSchema, idSchema, seedSchema } from './ids.ts';
import { POSITIONS, positionSchema } from './positions.ts';
import {
  HAVOC_DRAFT_ROUNDS,
  HAVOC_OFFER_SIZE,
  HAVOC_SCHEMA_VERSION,
  havocVersionSetSchema,
} from './havoc-versions.ts';
import {
  havocClaimKeySchema,
  havocEffectiveProfileSchema,
  havocSourcePlayerSchema,
} from './havoc-profile.ts';
import { havocMutationPackageSchema, havocTierSchema } from './havoc-mutations.ts';

export const havocOfferIdSchema = z.string().regex(/^hvo-[0-9a-f]{32}$/);
export type HavocOfferId = z.infer<typeof havocOfferIdSchema>;
export const havocCardIdSchema = z.string().regex(/^hvc-[0-9a-f]{32}$/);
export type HavocCardId = z.infer<typeof havocCardIdSchema>;

export const havocCatalogSourceSchema = z.object({
  catalogVersion: z.string().min(1).max(64),
  catalogHash: contentHashSchema,
  dataVersion: z.string().min(1).max(64),
  ratingsVersion: z.string().min(1).max(64),
  playerVersionIdVersion: z.string().min(1).max(64),
  positionNormalizationVersion: z.string().min(1).max(64),
});
export type HavocCatalogSource = z.infer<typeof havocCatalogSourceSchema>;

export const havocAdaptedCandidateSchema = havocSourcePlayerSchema.extend({
  claimKey: havocClaimKeySchema,
});
export type HavocAdaptedCandidate = z.infer<typeof havocAdaptedCandidateSchema>;

export const havocCatalogSchema = z.object({
  source: havocCatalogSourceSchema,
  candidates: z.array(havocAdaptedCandidateSchema).min(1),
});
export type HavocCatalog = z.infer<typeof havocCatalogSchema>;

export const havocDraftCardSchema = z.object({
  cardId: havocCardIdSchema,
  offerId: havocOfferIdSchema,
  cardIndex: z
    .number()
    .int()
    .min(0)
    .max(HAVOC_OFFER_SIZE - 1),
  slot: positionSchema,
  tier: havocTierSchema,
  source: havocSourcePlayerSchema,
  mutations: havocMutationPackageSchema,
  effective: havocEffectiveProfileSchema,
  nickname: z.string().min(1).max(64),
});
export type HavocDraftCard = z.infer<typeof havocDraftCardSchema>;

export const havocDraftPickSchema = z.object({
  pickOrdinal: z
    .number()
    .int()
    .min(0)
    .max(HAVOC_DRAFT_ROUNDS - 1),
  slot: positionSchema,
  claimKey: havocClaimKeySchema,
  card: havocDraftCardSchema,
});
export type HavocDraftPick = z.infer<typeof havocDraftPickSchema>;

export const havocDraftOfferSchema = z.object({
  offerId: havocOfferIdSchema,
  offerIndex: z.number().int().nonnegative(),
  round: z.number().int().min(1).max(HAVOC_DRAFT_ROUNDS),
  slot: positionSchema,
  cards: z.array(havocDraftCardSchema).length(HAVOC_OFFER_SIZE),
});
export type HavocDraftOffer = z.infer<typeof havocDraftOfferSchema>;

export const havocDraftStateSchema = z
  .object({
    schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    runSeed: seedSchema,
    versionSet: havocVersionSetSchema,
    catalog: havocCatalogSourceSchema,
    round: z.number().int().min(1).max(HAVOC_DRAFT_ROUNDS),
    slot: positionSchema,
    offerId: havocOfferIdSchema,
    offerIndex: z.number().int().min(0),
    cards: z.array(havocDraftCardSchema).length(HAVOC_OFFER_SIZE),
    rerollUsed: z.boolean(),
    picks: z.array(havocDraftPickSchema).max(HAVOC_DRAFT_ROUNDS),
    status: z.enum(['drafting', 'complete']),
  })
  .superRefine((state, ctx) => {
    const drafting = state.status === 'drafting';
    const expectedPicks = state.round - 1;
    if (drafting && state.picks.length !== expectedPicks) {
      ctx.addIssue({
        code: 'custom',
        message: `round ${String(state.round)} requires ${String(expectedPicks)} completed picks`,
      });
    }
    if (!drafting && state.picks.length !== HAVOC_DRAFT_ROUNDS) {
      ctx.addIssue({ code: 'custom', message: 'a complete draft requires five picks' });
    }
    if (drafting) {
      const expectedSlot = POSITIONS[state.picks.length];
      if (expectedSlot !== undefined && state.slot !== expectedSlot) {
        ctx.addIssue({
          code: 'custom',
          message: `pick ${String(state.picks.length + 1)} must fill ${expectedSlot}`,
        });
      }
    }
    if (state.offerIndex > 0 && !state.rerollUsed) {
      ctx.addIssue({ code: 'custom', message: 'offer index advanced without reroll use' });
    }
    for (const card of state.cards) {
      if (card.offerId !== state.offerId) {
        ctx.addIssue({ code: 'custom', message: 'card offer id does not match the draft offer' });
      }
      if (card.slot !== state.slot) {
        ctx.addIssue({ code: 'custom', message: 'card slot does not match the draft slot' });
      }
      if (card.mutations.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'draft cards require at least one mutation' });
      }
    }
    const seenClaims = new Set<string>();
    state.picks.forEach((pick, index) => {
      if (pick.pickOrdinal !== index) {
        ctx.addIssue({ code: 'custom', message: 'pick ordinals must be sequential' });
      }
      if (pick.card.slot !== pick.slot) {
        ctx.addIssue({ code: 'custom', message: 'picked card slot does not match the pick slot' });
      }
      const key = `${pick.claimKey.playerId}::${pick.claimKey.seasonKey}`;
      if (
        pick.card.source.playerId !== pick.claimKey.playerId ||
        pick.card.source.seasonKey !== pick.claimKey.seasonKey
      ) {
        ctx.addIssue({ code: 'custom', message: 'pick claim key does not match the picked card' });
      }
      if (seenClaims.has(key)) {
        ctx.addIssue({ code: 'custom', message: `claim ${key} drafted twice` });
      }
      seenClaims.add(key);
    });
  });
export type HavocDraftState = z.infer<typeof havocDraftStateSchema>;
