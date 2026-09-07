import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import {
  SEASON_CHALLENGE_VERSION,
} from './season-versions.ts';

export const seasonChallengeIdSchema = z.enum([
  'winning-block',
  'win-six',
  'three-point-mark',
  'protect-glass',
  'take-care',
  'beat-leader',
  'beat-higher',
  'statement-block',
]);
export type SeasonChallengeId = z.infer<typeof seasonChallengeIdSchema>;

export const seasonChallengeDifficultySchema = z.enum(['standard', 'hard']);
export type SeasonChallengeDifficulty = z.infer<typeof seasonChallengeDifficultySchema>;

export const seasonChallengeDefinitionSchema = z
  .object({
    challengeId: seasonChallengeIdSchema,
    name: z.string().min(1).max(64),
    description: z.string().min(1).max(256),
    measure: z.string().min(1).max(256),
    difficulty: seasonChallengeDifficultySchema,
    reward: z.union([z.literal(1), z.literal(2)]),
  })
  .strict()
  .superRefine((def, ctx) => {
    if (def.difficulty === 'standard' && def.reward !== 1) {
      ctx.addIssue({ code: 'custom', message: 'standard challenges must pay +1' });
    }
    if (def.difficulty === 'hard' && def.reward !== 2) {
      ctx.addIssue({ code: 'custom', message: 'hard challenges must pay +2' });
    }
  });
export type SeasonChallengeDefinition = z.infer<typeof seasonChallengeDefinitionSchema>;

export const SEASON_CHALLENGE_CATALOG = [
  {
    challengeId: 'winning-block',
    name: 'Winning Block',
    description: 'Finish the block over .500.',
    measure: 'wins > games / 2 across the block team games',
    difficulty: 'standard',
    reward: 1,
  },
  {
    challengeId: 'win-six',
    name: 'Win Six',
    description: "Win at least 6 of the block's team games.",
    measure: 'wins >= 6 across the block team games',
    difficulty: 'standard',
    reward: 1,
  },
  {
    challengeId: 'three-point-mark',
    name: 'Three-Point Mark',
    description: 'Shoot at least 35% from three (min 20 attempts).',
    measure: 'threePointPct >= 0.35 with threePointAttempted >= 20',
    difficulty: 'standard',
    reward: 1,
  },
  {
    challengeId: 'protect-glass',
    name: 'Protect the Glass',
    description: 'Finish the block with a positive rebound margin.',
    measure: 'reboundMargin > 0 across the block',
    difficulty: 'standard',
    reward: 1,
  },
  {
    challengeId: 'take-care',
    name: 'Take Care',
    description: 'Average at most 13.0 turnovers per team game.',
    measure: 'turnovers / games <= 13.0',
    difficulty: 'standard',
    reward: 1,
  },
  {
    challengeId: 'beat-leader',
    name: 'Beat the Leader',
    description: 'Beat the conference leader in this block.',
    measure: 'win vs standings leader at deal time, scheduled in block',
    difficulty: 'hard',
    reward: 2,
  },
  {
    challengeId: 'beat-higher',
    name: 'Beat Higher',
    description: 'Beat a team with a better record at tipoff.',
    measure: 'win vs higher-record opponent scheduled in block',
    difficulty: 'hard',
    reward: 2,
  },
  {
    challengeId: 'statement-block',
    name: 'Statement Block',
    description: 'Win every team game in the block (min 4 games).',
    measure: 'wins == games with games >= 4',
    difficulty: 'hard',
    reward: 2,
  },
] as const satisfies readonly SeasonChallengeDefinition[];

export const seasonChallengeTargetSnapshotSchema = z
  .object({
    gamesInBlock: z.number().int().min(1).max(10),
    leaderFranchiseId: franchiseIdSchema.nullable(),
    qualifyingOpponentIds: z.array(franchiseIdSchema).max(30),
    threePointAttemptFloor: z.number().int().min(0).max(100).optional(),
  })
  .strict();
export type SeasonChallengeTargetSnapshot = z.infer<typeof seasonChallengeTargetSnapshotSchema>;

export const seasonChallengeDealSchema = z
  .object({
    blockIndex: z.number().int().min(0).max(7),
    challengeIds: z
      .array(seasonChallengeIdSchema)
      .length(3)
      .superRefine((ids, ctx) => {
        if (new Set(ids).size !== 3) {
          ctx.addIssue({ code: 'custom', message: 'deal must hold 3 distinct challenges' });
        }
        const sorted = [...ids].sort();
        for (let i = 0; i < ids.length; i += 1) {
          if (ids[i] !== sorted[i]) {
            ctx.addIssue({
              code: 'custom',
              message: 'deal challengeIds must be in canonical sorted order',
            });
            break;
          }
        }
      }),
    seedDigest: z.string().regex(/^[0-9a-f]{32}$/),
    contextDigest: z.string().regex(/^[0-9a-f]{32}$/),
    seedPath: z.array(z.string().min(1).max(64)).min(1).max(8).optional(),
    standingsSnapshot: z
      .array(
        z
          .object({
            franchiseId: franchiseIdSchema,
            wins: z.number().int().nonnegative(),
            losses: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    targets: seasonChallengeTargetSnapshotSchema,
  })
  .strict();
export type SeasonChallengeDeal = z.infer<typeof seasonChallengeDealSchema>;

export const seasonChallengeInstanceSchema = z
  .object({
    challengeId: seasonChallengeIdSchema,
    blockIndex: z.number().int().min(0).max(7),
    difficulty: seasonChallengeDifficultySchema,
    reward: z.union([z.literal(1), z.literal(2)]),
    seedDigest: z.string().regex(/^[0-9a-f]{32}$/),
    contextDigest: z.string().regex(/^[0-9a-f]{32}$/),
    targets: seasonChallengeTargetSnapshotSchema,
  })
  .strict();
export type SeasonChallengeInstance = z.infer<typeof seasonChallengeInstanceSchema>;

export const seasonChallengeEvaluationFactsSchema = z
  .object({
    games: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    threePointersMade: z.number().int().nonnegative(),
    threePointersAttempted: z.number().int().nonnegative(),
    threePointPct: z.number().min(0).max(1).nullable(),
    reboundMargin: z.number().int(),
    turnovers: z.number().int().nonnegative(),
    turnoversPerGame: z.number().nonnegative().nullable(),
    beatLeader: z.boolean().nullable(),
    beatHigher: z.boolean().nullable(),
    sweptBlock: z.boolean(),
  })
  .strict();
export type SeasonChallengeEvaluationFacts = z.infer<typeof seasonChallengeEvaluationFactsSchema>;

export const seasonChallengeResultSchema = z
  .object({
    challengeId: seasonChallengeIdSchema,
    blockIndex: z.number().int().min(0).max(7),
    success: z.boolean(),
    facts: seasonChallengeEvaluationFactsSchema,
  })
  .strict();
export type SeasonChallengeResult = z.infer<typeof seasonChallengeResultSchema>;

export const seasonBlockChallengeEvaluationSchema = z
  .object({
    blockIndex: z.number().int().min(0).max(7),
    results: z.array(seasonChallengeResultSchema).length(3),
  })
  .strict()
  .superRefine((evaluation, ctx) => {
    const ids = evaluation.results.map((r) => r.challengeId);
    if (new Set(ids).size !== 3) {
      ctx.addIssue({ code: 'custom', message: 'block evaluation must hold 3 distinct challenges' });
    }
    for (const result of evaluation.results) {
      if (result.blockIndex !== evaluation.blockIndex) {
        ctx.addIssue({
          code: 'custom',
          message: `result ${result.challengeId} blockIndex mismatches evaluation block`,
        });
      }
    }
    const sorted = [...ids].sort();
    for (let i = 0; i < ids.length; i += 1) {
      if (ids[i] !== sorted[i]) {
        ctx.addIssue({
          code: 'custom',
          message: 'block evaluation results must be in canonical sorted order',
        });
        break;
      }
    }
  });
export type SeasonBlockChallengeEvaluation = z.infer<typeof seasonBlockChallengeEvaluationSchema>;

export const seasonChallengeStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    challengeVersion: z.literal(SEASON_CHALLENGE_VERSION),
    catalog: z.array(seasonChallengeDefinitionSchema).length(8),
    deals: z.record(z.coerce.number().int().min(0).max(7), seasonChallengeDealSchema),
    evaluations: z.array(seasonBlockChallengeEvaluationSchema),
  })
  .strict()
  .superRefine((state, ctx) => {
    const ids = new Set<string>();
    for (const entry of state.catalog) {
      if (ids.has(entry.challengeId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate challenge in catalog: ${entry.challengeId}`,
        });
      }
      ids.add(entry.challengeId);
    }
    if (ids.size !== 8) {
      ctx.addIssue({
        code: 'custom',
        message: `catalog must hold all eight challenges (found ${String(ids.size)})`,
      });
    }
    for (const [blockKey, deal] of Object.entries(state.deals)) {
      const blockIndex = Number(blockKey);
      if (blockIndex < 0 || blockIndex > 7) {
        ctx.addIssue({ code: 'custom', message: `deal blockIndex out of range: ${blockKey}` });
      }
      if (deal.blockIndex !== blockIndex) {
        ctx.addIssue({
          code: 'custom',
          message: `deal blockIndex ${String(deal.blockIndex)} mismatches key ${blockKey}`,
        });
      }
    }
    if (Object.keys(state.deals).includes('8')) {
      ctx.addIssue({ code: 'custom', message: 'block 8 must never carry a challenge deal' });
    }
    const seen = new Set<string>();
    for (const evaluation of state.evaluations) {
      const key = String(evaluation.blockIndex);
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', message: `duplicate evaluation for block ${key}` });
      }
      seen.add(key);
    }
  });
export type SeasonChallengeState = z.infer<typeof seasonChallengeStateSchema>;

export function buildEmptyChallengeState(): SeasonChallengeState {
  return {
    schemaVersion: 1,
    challengeVersion: SEASON_CHALLENGE_VERSION,
    catalog: [...SEASON_CHALLENGE_CATALOG],
    deals: {},
    evaluations: [],
  };
}

export function challengeInstancesOfDeal(deal: SeasonChallengeDeal): SeasonChallengeInstance[] {
  const catalogById = new Map(SEASON_CHALLENGE_CATALOG.map((entry) => [entry.challengeId, entry]));
  return deal.challengeIds.map((challengeId) => {
    const definition = catalogById.get(challengeId);
    if (!definition) throw new Error(`unknown challenge ${challengeId}`);
    return {
      challengeId,
      blockIndex: deal.blockIndex,
      difficulty: definition.difficulty,
      reward: definition.reward,
      seedDigest: deal.seedDigest,
      contextDigest: deal.contextDigest,
      targets: deal.targets,
    };
  });
}
