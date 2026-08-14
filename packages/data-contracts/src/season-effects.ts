import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_STAMINA_LEGACY_VERSION, SEASON_STAMINA_VERSION } from './season-versions.ts';

/**
 * M2.4 stamina and chemistry effects contracts (spec/2.0/05, spec/2.0/10).
 * The season engine consumes stamina inputs per player, tracks per-player
 * load and per-pair shared-possession chemistry across games, applies
 * bounded effects through named possession mechanisms, and records the
 * evidence that explanations and calibration audits read.
 *
 * M2.6.5 (spec/2.0/15, season-chemistry-v2): the effects state is
 * rotation-scoped. `playerStates` holds exactly 300 ACTIVE load records —
 * one per locked rotation member — and `pairStates` exactly 1,350 ACTIVE
 * canonical pairs (45 per ten-player rotation). Inactive depth owns
 * `inactivePlayerStates` (0-150 records, frozen while inactive) and
 * archived pairs carry `franchiseId` and preserve demoted relationships
 * without counting as active pairs. Game transitions carry only the 300
 * active players, so game inputs/results stay exactly ten rotation players
 * and zero-signing cohorts reproduce the prior seeded summaries
 * byte-for-byte.
 *
 * All probability-style values are integer millionths (probability ×
 * 1,000,000). Bounds are generous enough that no legitimate engine output
 * can be rejected; the tight, authoritative bounds live in the frozen
 * season-effect-targets-v1 calibration artifact, not in these shapes.
 */

/** The six named M2.4 possession mechanisms that fatigue/chemistry affect. */
export const seasonMechanismSchema = z.enum([
  'shooter-fatigue',
  'handler-fatigue',
  'defensive-unit-fatigue',
  'turnover-security',
  'assist-conversion',
  'help-defense',
]);
export type SeasonMechanism = z.infer<typeof seasonMechanismSchema>;

/** Which side of a game a mechanism evidence row describes. */
export const seasonEffectsSideSchema = z.enum(['home', 'away']);
export type SeasonEffectsSide = z.infer<typeof seasonEffectsSideSchema>;

/**
 * Build-time stamina profile for one player version (season-stamina-v2;
 * v1 profiles stay readable). Derived once per player-season from the pool's
 * recorded minutes and games played; the engine reads it from the
 * catalog-derived player input (or the absence of one means the zero
 * profile).
 */
export const seasonStaminaInputSchema = z.object({
  schemaVersion: z.literal(1),
  playerVersionId: playerVersionIdSchema,
  /** 45..95 stamina rating derived from historical MPG (45 = floor). */
  rating: z.number().int().min(45).max(95),
  /** Recorded historical minutes per game, capped at 60. */
  historicalMpg: z.number().min(0).max(60),
  derivationVersion: z.union([
    z.literal(SEASON_STAMINA_VERSION),
    z.literal(SEASON_STAMINA_LEGACY_VERSION),
  ]),
});
export type SeasonStaminaInput = z.infer<typeof seasonStaminaInputSchema>;

/**
 * One player's fatigue load at a game boundary. `fatigueBasisPoints` is the
 * carry-in fatigue (0 = fresh, 10,000 = max); `recentLoadBasisPoints` is the
 * accumulated consecutive-game workload; `lastCompletedRound` is the round
 * of the last game the player finished (0 before any game).
 */
export const seasonPlayerLoadStateSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  fatigueBasisPoints: z.number().int().min(0).max(10_000),
  recentLoadBasisPoints: z.number().int().min(0).max(10_000),
  lastCompletedRound: z.number().int().min(0).max(82),
});
export type SeasonPlayerLoadState = z.infer<typeof seasonPlayerLoadStateSchema>;

/**
 * One canonical player pair and its shared-possession chemistry. Pairs are
 * ordered lexicographically (`a < b`) so each roster's 45 pairs and the
 * league's 1,350 pairs have exactly one representation. Chemistry accrues
 * only through recorded shared play.
 */
export const seasonPairChemistryStateSchema = z
  .object({
    a: playerVersionIdSchema,
    b: playerVersionIdSchema,
    sharedPossessions: z.number().int().min(0).max(10_000_000),
  })
  .superRefine((pair, ctx) => {
    if (pair.a >= pair.b) {
      ctx.addIssue({
        code: 'custom',
        message: `pair is not canonical (a < b): ${pair.a} >= ${pair.b}`,
      });
    }
  });
export type SeasonPairChemistryState = z.infer<typeof seasonPairChemistryStateSchema>;

/**
 * One archived pair record (season-chemistry-v2): a demoted player's frozen
 * chemistry with a former rotation teammate. Archived records preserve the
 * relationship for a later promotion (restore) without counting as active
 * pairs; a trade deletes the traded player's archived records. `a < b`
 * canonically; `franchiseId` records the roster the pair belonged to.
 */
export const seasonArchivedPairChemistryStateSchema = z
  .object({
    franchiseId: franchiseIdSchema,
    a: playerVersionIdSchema,
    b: playerVersionIdSchema,
    sharedPossessions: z.number().int().min(0).max(10_000_000),
  })
  .superRefine((pair, ctx) => {
    if (pair.a >= pair.b) {
      ctx.addIssue({
        code: 'custom',
        message: `archived pair is not canonical (a < b): ${pair.a} >= ${pair.b}`,
      });
    }
  });
export type SeasonArchivedPairChemistryState = z.infer<
  typeof seasonArchivedPairChemistryStateSchema
>;

/**
 * The effects state frozen in each candidate checkpoint (schema 2,
 * season-chemistry-v2): exactly 300 ACTIVE player load states (one per
 * locked rotation member across the 30-team league), zero to 150 inactive
 * player load states (rostered depth outside the rotation, frozen while
 * inactive), exactly 1,350 ACTIVE canonical pair states (45 per ten-player
 * rotation), and zero or more archived pairs carrying `franchiseId`.
 * Every active pair member must be an active player, every active
 * playerVersionId unique (active and inactive sets disjoint), every active
 * pair canonical, and every archived pair canonical.
 */
export const seasonEffectsStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    /** Exactly 300 ACTIVE load records (one per locked rotation member). */
    playerStates: z.array(seasonPlayerLoadStateSchema).length(300),
    /** Zero to 150 inactive load records, frozen while inactive. */
    inactivePlayerStates: z.array(seasonPlayerLoadStateSchema).max(150),
    /** Exactly 1,350 ACTIVE canonical pairs (45 per ten-player rotation). */
    pairStates: z.array(seasonPairChemistryStateSchema).length(1350),
    /** Archived demoted-relationship records with franchiseId (max 1,350). */
    archivedPairs: z.array(seasonArchivedPairChemistryStateSchema).max(1350),
  })
  .superRefine((state, ctx) => {
    const players = new Set<string>();
    for (const player of state.playerStates) {
      if (players.has(player.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate player load state ${player.playerVersionId}`,
        });
      }
      players.add(player.playerVersionId);
    }
    const inactivePlayers = new Set<string>();
    for (const player of state.inactivePlayerStates) {
      if (inactivePlayers.has(player.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate inactive player load state ${player.playerVersionId}`,
        });
      }
      inactivePlayers.add(player.playerVersionId);
      if (players.has(player.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `player ${player.playerVersionId} appears both active and inactive`,
        });
      }
    }
    const pairs = new Set<string>();
    for (const pair of state.pairStates) {
      const key = `${pair.a}\u0000${pair.b}`;
      if (pairs.has(key)) {
        ctx.addIssue({ code: 'custom', message: `duplicate pair state ${key}` });
      }
      pairs.add(key);
      if (!players.has(pair.a) || !players.has(pair.b)) {
        ctx.addIssue({
          code: 'custom',
          message: `pair member is not an active rotation player: ${key}`,
        });
      }
      if (pair.a >= pair.b) {
        ctx.addIssue({ code: 'custom', message: `pair is not canonical: ${key}` });
      }
    }
    const archived = new Set<string>();
    for (const pair of state.archivedPairs) {
      const key = `${pair.franchiseId}\u0000${pair.a}\u0000${pair.b}`;
      if (archived.has(key)) {
        ctx.addIssue({ code: 'custom', message: `duplicate archived pair ${key}` });
      }
      archived.add(key);
      if (pair.a >= pair.b) {
        ctx.addIssue({ code: 'custom', message: `archived pair is not canonical: ${key}` });
      }
    }
  });
export type SeasonEffectsState = z.infer<typeof seasonEffectsStateSchema>;

/**
 * Recorded evidence for one mechanism on one side of one game. `opportunities`
 * counts the times the mechanism could apply; `inputTotals` accumulate the
 * integer-millionths inputs the engine fed the mechanism (shooter fatigue,
 * handler fatigue, defensive-unit fatigue mean, and unit chemistry, in
 * millionths; fields are always present, zero when unused); `deltaTotals`
 * accumulates the applied probability deltas in millionths (may be negative);
 * `deltaMin`/`deltaMax` bound the per-opportunity delta so calibration and
 * explanations can audit the effect size.
 */
export const seasonMechanismEvidenceSchema = z.object({
  mechanism: seasonMechanismSchema,
  side: seasonEffectsSideSchema,
  opportunities: z.number().int().min(0).max(1_000_000),
  inputTotals: z.object({
    shooter: z.number().int().min(0).max(1_000_000_000_000),
    handler: z.number().int().min(0).max(1_000_000_000_000),
    defenseMean: z.number().int().min(0).max(1_000_000_000_000),
    unitChemistry: z.number().int().min(0).max(1_000_000_000_000),
  }),
  deltaTotals: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
  deltaMin: z.number().int().min(-1_000_000).max(1_000_000),
  deltaMax: z.number().int().min(-1_000_000).max(1_000_000),
});
export type SeasonMechanismEvidence = z.infer<typeof seasonMechanismEvidenceSchema>;

/**
 * The effects delta one game produces: the 300 pregame and postgame ACTIVE
 * player load states (exactly the locked rotation members; inactive depth
 * never receives minutes, load, chemistry, or injury exposure), the
 * per-pair shared-possession increments (at most the 1,350 ACTIVE league
 * pairs), and the mechanism evidence rows (at most one per mechanism
 * per side: 6 x 2 = 12). The block pipeline folds these into the effects
 * state and the recap.
 */
export const seasonGameEffectsTransitionSchema = z.object({
  schemaVersion: z.literal(1),
  pregamePlayerStates: z.array(seasonPlayerLoadStateSchema).length(300),
  postgamePlayerStates: z.array(seasonPlayerLoadStateSchema).length(300),
  pairIncrements: z
    .array(
      z.object({
        a: playerVersionIdSchema,
        b: playerVersionIdSchema,
        sharedPossessions: z.number().int().min(0).max(10_000_000),
      }),
    )
    .max(1350),
  evidence: z.array(seasonMechanismEvidenceSchema).max(12),
});
export type SeasonGameEffectsTransition = z.infer<typeof seasonGameEffectsTransitionSchema>;

/**
 * Compact per-game effects rollup for game summaries (retention policy):
 * mechanism, side, opportunity count, and the accumulated delta total. The
 * richer evidence rows stay only in retained game detail.
 */
export const seasonEffectsRollupSchema = z.object({
  mechanism: seasonMechanismSchema,
  side: seasonEffectsSideSchema,
  opportunities: z.number().int().min(0).max(1_000_000),
  deltaTotal: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
});
export type SeasonEffectsRollup = z.infer<typeof seasonEffectsRollupSchema>;
