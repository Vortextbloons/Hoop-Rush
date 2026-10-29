import { z } from 'zod';
import {
  eraIdSchema,
  franchiseIdSchema,
  idSchema,
  playerIdSchema,
  seedSchema,
  seasonKeySchema,
} from './ids.ts';
import { positionSchema, positionUnionSchema } from './positions.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  reconstructedThreePointProfileSchema,
  simulationAnchorsSchema,
  simulationRatingsSchema,
  simulationTendenciesSchema,
} from './simulation.ts';
import {
  CAP_RUSH_DRAFT_ROUNDS,
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  CAP_RUSH_MAX_OVERALL,
  CAP_RUSH_MIN_OVERALL,
  CAP_RUSH_OFFER_SIZE,
  CAP_RUSH_REROLL_LIMIT,
  CAP_RUSH_SCHEMA_VERSION,
  capRushBucketSchema,
  capRushCardIdSchema,
  capRushCatalogSourceSchema,
  capRushOfferIdSchema,
  capRushVersionSetSchema,
  capRushVariantSchema,
} from './cap-rush-versions.ts';
import { capRushSpinStateSchema } from './cap-rush-spin.ts';
import { capRushLockedInputsSchema } from './cap-rush-lock.ts';
import { capRushSeasonStateSchema } from './cap-rush-season.ts';

export const capRushPlayerProfileSchema = z.object({
  ratings: simulationRatingsSchema,
  tendencies: simulationTendenciesSchema,
  anchors: simulationAnchorsSchema.optional(),
  reconstructedThreePoint: reconstructedThreePointProfileSchema.optional(),
});
export type CapRushPlayerProfile = z.infer<typeof capRushPlayerProfileSchema>;

export const capRushPhysicalSchema = z.object({
  heightInches: z.number().int().min(60).max(96).nullable(),
  weightLbs: z.number().int().min(120).max(400).nullable(),
});
export type CapRushPhysical = z.infer<typeof capRushPhysicalSchema>;

export const capRushSourcePlayerSchema = z.object({
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  displayName: z.string().min(1).max(96),
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  seasonKey: seasonKeySchema,
  positions: positionUnionSchema,
  originalOverall: z.number().int().min(CAP_RUSH_MIN_OVERALL).max(CAP_RUSH_MAX_OVERALL),
  profile: capRushPlayerProfileSchema,
  physical: capRushPhysicalSchema,
});
export type CapRushSourcePlayer = z.infer<typeof capRushSourcePlayerSchema>;

export const capRushCatalogSchema = z.object({
  source: capRushCatalogSourceSchema,
  candidates: z.array(capRushSourcePlayerSchema).min(1),
});
export type CapRushCatalog = z.infer<typeof capRushCatalogSchema>;

export const capRushCardSchema = z.object({
  cardId: capRushCardIdSchema,
  offerId: capRushOfferIdSchema,
  cardIndex: z
    .number()
    .int()
    .min(0)
    .max(CAP_RUSH_OFFER_SIZE - 1),
  slot: positionSchema,
  bucket: capRushBucketSchema,
  source: capRushSourcePlayerSchema,
  salaryDollars: z.number().int().min(0),
});
export type CapRushCard = z.infer<typeof capRushCardSchema>;

export const capRushOfferSchema = z.object({
  offerId: capRushOfferIdSchema,
  offerRevision: z.number().int().nonnegative(),
  round: z.number().int().min(1).max(CAP_RUSH_DRAFT_ROUNDS),
  slot: positionSchema,
  cards: z.array(capRushCardSchema).length(CAP_RUSH_OFFER_SIZE),
});
export type CapRushOffer = z.infer<typeof capRushOfferSchema>;

export const capRushDraftPickSchema = z.object({
  pickOrdinal: z
    .number()
    .int()
    .min(0)
    .max(CAP_RUSH_DRAFT_ROUNDS - 1),
  slot: positionSchema,
  card: capRushCardSchema,
});
export type CapRushDraftPick = z.infer<typeof capRushDraftPickSchema>;

export const capRushDraftStageSchema = z.enum([
  'select-position',
  'review-offer',
  'complete',
  'locked',
  'completed',
  'abandoned',
]);
export type CapRushDraftStage = z.infer<typeof capRushDraftStageSchema>;

export const capRushDraftStateSchema = z
  .object({
    schemaVersion: z.literal(CAP_RUSH_SCHEMA_VERSION),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    runSeed: seedSchema,
    variant: capRushVariantSchema,
    versionSet: capRushVersionSetSchema,
    catalog: capRushCatalogSourceSchema,
    stage: capRushDraftStageSchema,
    round: z.number().int().min(1).max(CAP_RUSH_DRAFT_ROUNDS),
    offer: capRushOfferSchema.nullable(),
    rerollsRemaining: z.number().int().min(0).max(CAP_RUSH_REROLL_LIMIT),
    picks: z.array(capRushDraftPickSchema).max(CAP_RUSH_DRAFT_ROUNDS),
    spin: capRushSpinStateSchema,
    locked: capRushLockedInputsSchema.nullable(),
    season: capRushSeasonStateSchema,
  })
  .superRefine((state, ctx) => {
    const seasonStarted = state.season.games.length > 0;
    if (state.stage === 'complete' || state.stage === 'locked') {
      if (state.picks.length !== CAP_RUSH_DRAFT_ROUNDS) {
        ctx.addIssue({ code: 'custom', message: 'a complete draft requires five picks' });
      }
      if (state.offer !== null) {
        ctx.addIssue({ code: 'custom', message: 'a complete draft cannot hold an open offer' });
      }
      if (state.locked !== null && state.stage !== 'locked') {
        ctx.addIssue({ code: 'custom', message: 'only a locked draft holds locked inputs' });
      }
      if (state.stage === 'locked' && state.locked === null) {
        ctx.addIssue({ code: 'custom', message: 'a locked draft requires locked inputs' });
      }
      if (seasonStarted && state.stage !== 'locked') {
        ctx.addIssue({ code: 'custom', message: 'an unlocked draft cannot hold season progress' });
      }
    } else if (state.stage === 'completed' || state.stage === 'abandoned') {
      if (state.picks.length !== CAP_RUSH_DRAFT_ROUNDS) {
        ctx.addIssue({ code: 'custom', message: 'a finished run requires five picks' });
      }
      if (state.locked === null) {
        ctx.addIssue({ code: 'custom', message: 'a finished run requires locked inputs' });
      }
      if (state.stage === 'abandoned' && state.season.completedAt !== null) {
        ctx.addIssue({ code: 'custom', message: 'an abandoned run cannot be completed' });
      }
    } else {
      if (state.picks.length >= CAP_RUSH_DRAFT_ROUNDS) {
        ctx.addIssue({
          code: 'custom',
          message: 'an incomplete draft requires at most four picks',
        });
      }
      if (state.round !== state.picks.length + 1) {
        ctx.addIssue({
          code: 'custom',
          message: `round ${String(state.round)} does not match ${String(state.picks.length)} completed picks`,
        });
      }
      if (state.stage === 'review-offer' && state.offer === null) {
        ctx.addIssue({ code: 'custom', message: 'reviewing a round requires an open offer' });
      }
      if (state.stage === 'select-position' && state.offer !== null) {
        ctx.addIssue({ code: 'custom', message: 'an open offer requires the review stage' });
      }
      if (state.offer !== null && state.offer.round !== state.round) {
        ctx.addIssue({ code: 'custom', message: 'offer round does not match the draft round' });
      }
    }

    if (state.stage !== 'complete' && state.stage !== 'locked') {
      if (state.spin.status !== 'unavailable') {
        ctx.addIssue({
          code: 'custom',
          message: 'only a completed Cap Roulette draft holds a spin decision',
        });
      }
    } else if (state.variant === 'clash') {
      if (state.spin.status !== 'unavailable') {
        ctx.addIssue({
          code: 'custom',
          message: 'Cap Clash never holds a spin decision',
        });
      }
    } else if (state.spin.status === 'unavailable') {
      ctx.addIssue({
        code: 'custom',
        message: 'a completed Cap Roulette draft requires a spin decision',
      });
    } else if (state.stage === 'locked' && state.spin.status === 'pending') {
      ctx.addIssue({
        code: 'custom',
        message: 'an unresolved spin decision cannot be locked',
      });
    }

    if (state.picks.length > 0) {
      const payroll = state.picks.reduce((total, pick) => total + pick.card.salaryDollars, 0);
      if (payroll > CAP_RUSH_HARD_LIMIT_DOLLARS) {
        ctx.addIssue({
          code: 'custom',
          message: `draft payroll $${String(payroll)} exceeds the hard limit`,
        });
      }
    }

    const seenPeople = new Set<string>();
    const seenSlots = new Set<string>();
    state.picks.forEach((pick, index) => {
      if (pick.pickOrdinal !== index) {
        ctx.addIssue({ code: 'custom', message: 'pick ordinals must be sequential' });
      }
      if (pick.slot !== pick.card.slot) {
        ctx.addIssue({ code: 'custom', message: 'picked card slot does not match the pick slot' });
      }
      if (!pick.card.source.positions.includes(pick.slot)) {
        ctx.addIssue({
          code: 'custom',
          message: `picked card ${pick.card.cardId} cannot play ${pick.slot}`,
        });
      }
      if (seenPeople.has(pick.card.source.playerId)) {
        ctx.addIssue({
          code: 'custom',
          message: `player ${pick.card.source.playerId} is signed twice`,
        });
      }
      seenPeople.add(pick.card.source.playerId);
      if (seenSlots.has(pick.slot)) {
        ctx.addIssue({ code: 'custom', message: `slot ${pick.slot} is filled twice` });
      }
      seenSlots.add(pick.slot);
    });

    if (state.offer !== null) {
      const offerPeople = new Set<string>();
      const seenIndexes = new Set<number>();
      for (const card of state.offer.cards) {
        if (card.offerId !== state.offer.offerId) {
          ctx.addIssue({ code: 'custom', message: 'card offer id does not match the open offer' });
        }
        if (card.slot !== state.offer.slot) {
          ctx.addIssue({ code: 'custom', message: 'card slot does not match the open offer' });
        }
        if (!card.source.positions.includes(card.slot)) {
          ctx.addIssue({
            code: 'custom',
            message: `offered card ${card.cardId} cannot play ${card.slot}`,
          });
        }
        if (seenIndexes.has(card.cardIndex)) {
          ctx.addIssue({ code: 'custom', message: 'offer card indexes must be distinct' });
        }
        seenIndexes.add(card.cardIndex);
        if (offerPeople.has(card.source.playerId)) {
          ctx.addIssue({
            code: 'custom',
            message: `offer contains player ${card.source.playerId} twice`,
          });
        }
        offerPeople.add(card.source.playerId);
        if (seenPeople.has(card.source.playerId)) {
          ctx.addIssue({ code: 'custom', message: 'offer contains an already signed player' });
        }
      }
      if (seenSlots.has(state.offer.slot)) {
        ctx.addIssue({ code: 'custom', message: 'the open offer targets a filled slot' });
      }
    }
  });
export type CapRushDraftState = z.infer<typeof capRushDraftStateSchema>;
