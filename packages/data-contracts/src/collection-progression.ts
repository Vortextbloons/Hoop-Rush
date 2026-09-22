import { z } from 'zod';
import { collectionChallengeDefinitionSchema } from './collection-challenge.ts';
import { collectionSetRewardDefinitionSchema } from './collection-set-reward.ts';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_CHALLENGE_REWARD_VERSION,
  COLLECTION_CHALLENGE_VERSION,
  COLLECTION_PROGRESSION_TARGETS_VERSION,
  COLLECTION_PROGRESSION_VERSION,
  COLLECTION_SET_REWARD_VERSION,
  COLLECTION_TARGETING_VERSION,
} from './collection-versions.ts';
import { contentHashSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';

export const collectionProgressionDisplaySchema = z
  .object({
    challengesTitle: z.string().min(1).max(64),
    challengesBlurb: z.string().min(1).max(240),
    targetingBlurb: z.string().min(1).max(240),
    setsTitle: z.string().min(1).max(64),
    setsBlurb: z.string().min(1).max(240),
  })
  .strict();
export type CollectionProgressionDisplay = z.infer<typeof collectionProgressionDisplaySchema>;

export const collectionProgressionRulesSchema = z
  .object({
    schemaVersion: z.literal(1),
    progressionVersion: z.literal(COLLECTION_PROGRESSION_VERSION),
    targetingVersion: z.literal(COLLECTION_TARGETING_VERSION),
    challengeVersion: z.literal(COLLECTION_CHALLENGE_VERSION),
    challengeRewardVersion: z.literal(COLLECTION_CHALLENGE_REWARD_VERSION),
    setRewardVersion: z.literal(COLLECTION_SET_REWARD_VERSION),
    sourceCatalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
    sourceCatalogHash: contentHashSchema,
    targetMultiplierBp: z.number().int().min(10_000),
    challenges: z.array(collectionChallengeDefinitionSchema).min(1).max(64),
    setRewards: z.array(collectionSetRewardDefinitionSchema).min(1).max(32),
    display: collectionProgressionDisplaySchema,
    contentDigest: seasonCheckpointDigestSchema,
  })
  .strict()
  .superRefine((rules, ctx) => {
    const challengeIds = new Set<string>();
    for (const challenge of rules.challenges) {
      if (challengeIds.has(challenge.challengeId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate challenge ${challenge.challengeId}` });
      }
      challengeIds.add(challenge.challengeId);
    }
    const setIds = new Set<string>();
    for (const reward of rules.setRewards) {
      if (setIds.has(reward.setId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate set reward ${reward.setId}` });
      }
      setIds.add(reward.setId);
      if (reward.title.length === 0) {
        ctx.addIssue({ code: 'custom', message: `set reward ${reward.setId} needs a title` });
      }
    }
  });
export type CollectionProgressionRules = z.infer<typeof collectionProgressionRulesSchema>;

export function collectionProgressionRulesDigest(
  rules: Omit<CollectionProgressionRules, 'contentDigest'>,
): string {
  const { contentDigest: _ignored, ...rest } = rules as CollectionProgressionRules;
  void _ignored;
  return seasonDigestHex(canonicalJson(rest));
}

export const collectionProgressionTargetsSchema = z
  .object({
    schemaVersion: z.literal(1),
    targetsVersion: z.literal(COLLECTION_PROGRESSION_TARGETS_VERSION),
    progressionVersion: z.literal(COLLECTION_PROGRESSION_VERSION),
    targetingVersion: z.literal(COLLECTION_TARGETING_VERSION),
    challengeVersion: z.literal(COLLECTION_CHALLENGE_VERSION),
    challengeRewardVersion: z.literal(COLLECTION_CHALLENGE_REWARD_VERSION),
    setRewardVersion: z.literal(COLLECTION_SET_REWARD_VERSION),
    catalogHash: contentHashSchema,
    progressionRulesHash: contentHashSchema,
    rulesHash: contentHashSchema,
    engineVersion: z.string().min(1).max(64),
    cohorts: z
      .object({
        calibrationSeeds: z.number().int().positive(),
        validationSeeds: z.number().int().positive(),
        ordinarySlotDraws: z.number().int().positive(),
        generatedAtIso: z.string().min(1).max(64),
      })
      .strict(),
    gates: z.record(z.string().min(1).max(160), z.boolean()),
    measured: z.record(z.string().min(1).max(160), z.number()),
    fixtures: z
      .array(
        z
          .object({
            fixtureId: z.string().min(1).max(64),
            collectionHash: seasonCheckpointDigestSchema,
          })
          .strict(),
      )
      .min(4),
  })
  .strict();
export type CollectionProgressionTargets = z.infer<typeof collectionProgressionTargetsSchema>;

export function collectionProgressionTargetsGateFailure(
  targets: CollectionProgressionTargets,
): string | null {
  const failing = Object.entries(targets.gates)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (failing.length === 0) return null;
  return `progression targets gates failed: ${failing.join(', ')}`;
}
