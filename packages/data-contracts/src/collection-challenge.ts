import { z } from 'zod';
import { collectionCardIdSchema, collectionSetIdSchema } from './collection-primitives.ts';
import { collectionDifficultyIdSchema } from './collection-difficulty.ts';
import { COLLECTION_CHALLENGE_VERSION } from './collection-versions.ts';
import { eraIdSchema, franchiseIdSchema, playerIdSchema } from './ids.ts';

export const collectionChallengeIdSchema = z
  .string()
  .regex(/^challenge-[a-z0-9-]{1,48}$/)
  .brand<'CollectionChallengeId'>();
export type CollectionChallengeId = z.infer<typeof collectionChallengeIdSchema>;

function boundedCounts(minimumRosterCount: number, minimumStarterCount: number): boolean {
  return minimumStarterCount <= 5 && minimumStarterCount <= minimumRosterCount;
}

const challengeRequirementRefine = (
  requirement: { minimumRosterCount: number; minimumStarterCount: number },
  ctx: z.RefinementCtx,
): void => {
  if (!boundedCounts(requirement.minimumRosterCount, requirement.minimumStarterCount)) {
    ctx.addIssue({
      code: 'custom',
      message: 'starter requirement must be at most 5 and at most the roster requirement',
    });
  }
};

export const collectionChallengeRequirementSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('era-core'),
      eraId: eraIdSchema,
      minimumRosterCount: z.number().int().min(1).max(12),
      minimumStarterCount: z.number().int().min(1).max(5),
    })
    .strict()
    .superRefine(challengeRequirementRefine),
  z
    .object({
      kind: z.literal('franchise-core'),
      franchiseId: franchiseIdSchema,
      minimumRosterCount: z.number().int().min(1).max(12),
      minimumStarterCount: z.number().int().min(1).max(5),
    })
    .strict()
    .superRefine(challengeRequirementRefine),
  z
    .object({
      kind: z.literal('set-family-core'),
      setId: collectionSetIdSchema,
      minimumRosterCount: z.number().int().min(1).max(12),
      minimumStarterCount: z.number().int().min(1).max(5),
    })
    .strict()
    .superRefine(challengeRequirementRefine),
]);
export type CollectionChallengeRequirement = z.infer<typeof collectionChallengeRequirementSchema>;

export const collectionChallengeDefinitionSchema = z
  .object({
    challengeVersion: z.literal(COLLECTION_CHALLENGE_VERSION),
    challengeId: collectionChallengeIdSchema,
    displayName: z.string().min(1).max(48),
    description: z.string().min(1).max(160),
    requirement: collectionChallengeRequirementSchema,
    difficultyId: collectionDifficultyIdSchema,
    firstClearCoins: z.number().int().positive(),
    repeatWinCoins: z.number().int().positive(),
  })
  .strict()
  .superRefine((definition, ctx) => {
    if (definition.repeatWinCoins > definition.firstClearCoins) {
      ctx.addIssue({
        code: 'custom',
        message: 'repeat-win reward must not exceed the first-clear reward',
      });
    }
  });
export type CollectionChallengeDefinition = z.infer<typeof collectionChallengeDefinitionSchema>;

export const collectionChallengeRosterEntrySchema = z
  .object({
    cardId: collectionCardIdSchema,
    playerId: z.union([playerIdSchema, z.literal('')]),
    starter: z.boolean(),
  })
  .strict();
export type CollectionChallengeRosterEntry = z.infer<typeof collectionChallengeRosterEntrySchema>;

export const collectionChallengeFailureCodeSchema = z.enum([
  'challenge-team-invalid',
  'challenge-roster-requirement',
]);
export type CollectionChallengeFailureCode = z.infer<typeof collectionChallengeFailureCodeSchema>;

export const collectionChallengeValidationFactsSchema = z
  .object({
    challengeVersion: z.literal(COLLECTION_CHALLENGE_VERSION),
    challengeId: collectionChallengeIdSchema,
    requirement: collectionChallengeRequirementSchema,
    activeRoster: z.array(collectionChallengeRosterEntrySchema).max(12),
    matchingCardIds: z.array(collectionCardIdSchema).max(12),
    matchingStarterIds: z.array(collectionCardIdSchema).max(5),
    rosterCount: z.number().int().nonnegative(),
    starterCount: z.number().int().nonnegative(),
    requiredRosterCount: z.number().int().min(1).max(12),
    requiredStarterCount: z.number().int().min(1).max(5),
    teamValid: z.boolean(),
    teamIssueCodes: z.array(z.string().min(1).max(64)),
    success: z.boolean(),
    failureCode: collectionChallengeFailureCodeSchema.nullable(),
  })
  .strict()
  .superRefine((facts, ctx) => {
    const rosterIds = facts.activeRoster.map((entry) => entry.cardId);
    if (new Set(rosterIds).size !== rosterIds.length) {
      ctx.addIssue({ code: 'custom', message: 'active roster has duplicate cards' });
    }
    const players = facts.activeRoster.map((entry) => entry.playerId).filter((id) => id !== '');
    if (new Set(players).size !== players.length) {
      ctx.addIssue({ code: 'custom', message: 'active roster has duplicate canonical players' });
    }
    const rosterSet = new Set(rosterIds);
    for (const cardId of facts.matchingCardIds) {
      if (!rosterSet.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `matching card ${cardId} is not on the roster` });
      }
    }
    const starterSet = new Set(
      facts.activeRoster.filter((entry) => entry.starter).map((e) => e.cardId),
    );
    for (const cardId of facts.matchingStarterIds) {
      if (!starterSet.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `matching starter ${cardId} is not a starter` });
      }
    }
    if (facts.rosterCount !== facts.matchingCardIds.length) {
      ctx.addIssue({ code: 'custom', message: 'roster count does not match matching cards' });
    }
    if (facts.starterCount !== facts.matchingStarterIds.length) {
      ctx.addIssue({ code: 'custom', message: 'starter count does not match matching starters' });
    }
    if (facts.requiredRosterCount !== facts.requirement.minimumRosterCount) {
      ctx.addIssue({
        code: 'custom',
        message: 'required roster count disagrees with the requirement',
      });
    }
    if (facts.requiredStarterCount !== facts.requirement.minimumStarterCount) {
      ctx.addIssue({
        code: 'custom',
        message: 'required starter count disagrees with the requirement',
      });
    }
    const requirementMet =
      facts.rosterCount >= facts.requiredRosterCount &&
      facts.starterCount >= facts.requiredStarterCount;
    const expectedSuccess = facts.teamValid && requirementMet;
    if (facts.success !== expectedSuccess) {
      ctx.addIssue({ code: 'custom', message: 'success flag disagrees with the recorded counts' });
    }
    const expectedFailure: string | null = expectedSuccess
      ? null
      : facts.teamValid
        ? 'challenge-roster-requirement'
        : 'challenge-team-invalid';
    if (facts.failureCode !== expectedFailure) {
      ctx.addIssue({ code: 'custom', message: 'failure code disagrees with the recorded facts' });
    }
  });
export type CollectionChallengeValidationFacts = z.infer<
  typeof collectionChallengeValidationFactsSchema
>;

export const collectionChallengePreparedSnapshotSchema = z
  .object({
    challengeVersion: z.literal(COLLECTION_CHALLENGE_VERSION),
    challengeId: collectionChallengeIdSchema,
    displayName: z.string().min(1).max(48),
    requirement: collectionChallengeRequirementSchema,
    difficultyId: collectionDifficultyIdSchema,
    firstClearCoins: z.number().int().positive(),
    repeatWinCoins: z.number().int().positive(),
    firstClearEligible: z.boolean(),
    validation: collectionChallengeValidationFactsSchema,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.validation.challengeId !== snapshot.challengeId) {
      ctx.addIssue({ code: 'custom', message: 'validation facts challenge id mismatch' });
    }
    if (!snapshot.validation.success) {
      ctx.addIssue({ code: 'custom', message: 'prepared challenge must have passed validation' });
    }
    if (
      snapshot.validation.requirement.minimumRosterCount !== snapshot.requirement.minimumRosterCount
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'validation requirement disagrees with the snapshot',
      });
    }
  });
export type CollectionChallengePreparedSnapshot = z.infer<
  typeof collectionChallengePreparedSnapshotSchema
>;

export const collectionChallengeClearStateSchema = z
  .object({
    clearedChallengeIds: z.array(collectionChallengeIdSchema),
  })
  .strict()
  .superRefine((state, ctx) => {
    const seen = new Set<string>();
    let previous = '';
    for (const challengeId of state.clearedChallengeIds) {
      if (seen.has(challengeId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate cleared challenge ${challengeId}` });
      }
      if (seen.size > 0 && challengeId <= previous) {
        ctx.addIssue({ code: 'custom', message: 'cleared challenge ids must be canonical sorted' });
      }
      seen.add(challengeId);
      previous = challengeId;
    }
  });
export type CollectionChallengeClearState = z.infer<typeof collectionChallengeClearStateSchema>;

export const collectionChallengeComponentKindSchema = z.enum([
  'challenge-first-clear',
  'challenge-repeat-win',
]);
export type CollectionChallengeComponentKind = z.infer<
  typeof collectionChallengeComponentKindSchema
>;

export const collectionChallengeEvaluationSchema = z
  .object({
    challengeVersion: z.literal(COLLECTION_CHALLENGE_VERSION),
    challengeId: collectionChallengeIdSchema,
    difficultyId: collectionDifficultyIdSchema,
    firstClearEligible: z.boolean(),
    firstClearGranted: z.boolean(),
    componentKind: collectionChallengeComponentKindSchema.nullable(),
  })
  .strict()
  .superRefine((evaluation, ctx) => {
    const expectedKind = evaluation.firstClearGranted
      ? 'challenge-first-clear'
      : evaluation.componentKind;
    if (evaluation.firstClearGranted && evaluation.componentKind !== 'challenge-first-clear') {
      ctx.addIssue({ code: 'custom', message: 'first clear must use the first-clear component' });
    }
    if (evaluation.firstClearGranted && !evaluation.firstClearEligible) {
      ctx.addIssue({ code: 'custom', message: 'first clear requires prior eligibility' });
    }
    void expectedKind;
  });
export type CollectionChallengeEvaluation = z.infer<typeof collectionChallengeEvaluationSchema>;
