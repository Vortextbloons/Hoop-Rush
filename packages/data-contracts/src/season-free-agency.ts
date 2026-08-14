import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, idSchema, playerIdSchema } from './ids.ts';
import {
  positionNormalizationVersionSchema,
  positionSchema,
  positionUnionSchema,
} from './positions.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_FREE_AGENCY_VERSION } from './season-versions.ts';

/**
 * M2.6.5 free-agency market contracts (spec/2.0/15, season-free-agency-v1).
 * Three shared markets open atomically after accepted checkpoints for
 * regular-season blocks 2, 4, and 6 (windowIndex 0, 1, 2). Each window
 * contains up to 12 unique canonical identities (1 featured, 5 role,
 * 3 development, 3 emergency) drawn from the manifest-hashed build-time
 * eligibility index; a window remains `open` until explicitly resolved, and
 * the following block submission is authoritatively rejected with
 * `free-agency-unresolved` while any window stays open.
 *
 * Every candidate is a canonical identity choice recorded in market
 * history: on first admission the run selects one canonical player-season
 * version per real identity (named seed `free-agency/{window}/canonical/
 * {playerId}`), persists it, and later markets reuse it while excluding all
 * sibling versions. Ownership remains the runtime authority.
 *
 * Declarations are one immutable choice per controlled franchise per
 * window: one or two ordered targets with a supported role expectation and
 * committed Influence, or an explicit skip. Resolution compares first
 * priorities simultaneously by candidate, then second priorities for
 * franchises that did not sign; each franchise signs at most one player and
 * winners leave every remaining target list. The recorded seven-step vector
 * (legality, role credibility, need, identity fit, opportunity, Influence,
 * named-seed draw) produces categorical traces only.
 *
 * Influence: emergency costs 1, role/development 1-2, featured 2-3, never
 * more than 3; a franchise may commit the displayed minimum through 3; the
 * winning commitment is debited and losing/cancelled/skipped/stale/rejected
 * targets cost zero; available non-debt balance must cover the commitment;
 * at most 6 Influence on free agency per season and 3 signings per season.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** Market quality bands (spec/2.0/15 eligibility and quality controls). */
export const seasonFreeAgencyBandSchema = z.enum(['featured', 'role', 'development', 'emergency']);
export type SeasonFreeAgencyBand = z.infer<typeof seasonFreeAgencyBandSchema>;

/** Supported role expectations on an interest target. */
export const seasonFreeAgencyRoleExpectationSchema = z.enum(['rotation', 'depth', 'emergency']);
export type SeasonFreeAgencyRoleExpectation = z.infer<typeof seasonFreeAgencyRoleExpectationSchema>;

/**
 * Compact player-slice facts shown on candidate cards: eligibility
 * positions, band, minimum Influence cost, supported roles, factual
 * strengths/limitations (max 8 each), durability/availability facts, and a
 * bounded minutes-per-game record. Rationales cite recorded facts only.
 */
export const seasonFreeAgencyCandidateSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  playerId: playerIdSchema,
  displayName: z.string().min(1).max(96),
  /** Eligible positions from the catalog record. */
  positions: z.object({
    primary: positionSchema,
    secondary: z.array(positionSchema).max(4),
    playable: positionUnionSchema,
    normalizationVersion: positionNormalizationVersionSchema,
  }),
  band: seasonFreeAgencyBandSchema,
  /** Minimum Influence commitment: emergency 1; role/development 1-2; featured 2-3. */
  minimumInfluence: z.number().int().min(1).max(3),
  /** The role expectations this candidate supports on a declaration. */
  supportedRoles: z.array(seasonFreeAgencyRoleExpectationSchema).min(1).max(3),
  /** Factual strengths, max 8 (derived at build time). */
  strengths: z.array(z.string().min(1).max(160)).max(8),
  /** Factual limitations, max 8 (derived at build time). */
  limitations: z.array(z.string().min(1).max(160)).max(8),
  /** Build-time durability rating (durability-v1, 45..95). */
  durabilityRating: z.number().int().min(45).max(95),
  /** Recorded historical minutes per game, capped at 60. */
  minutesPerGame: z.number().min(0).max(60),
  /** Availability facts recorded at build time (healthy eligibility). */
  availability: z.object({
    healthy: z.boolean(),
    notes: z.string().max(256),
  }),
  /**
   * Reference into the packaged draft catalog record: the catalog artifact
   * version and the candidate's index inside its `candidates` array.
   */
  catalogRef: z.object({
    catalogVersion: z.string().min(1).max(64),
    dataVersion: z.string().min(1).max(64),
    candidateIndex: z.number().int().nonnegative(),
  }),
  /** Derivation evidence (why this version/index entry exists). */
  derivationEvidence: z.string().min(1).max(256),
  /** Exclusion evidence for sibling versions of the same identity. */
  exclusionEvidence: z.string().max(256),
});
export type SeasonFreeAgencyCandidate = z.infer<typeof seasonFreeAgencyCandidateSchema>;

/**
 * One persisted canonical identity choice. Every admitted identity records
 * its canonical version, band, the window that admitted it, and the named
 * seed path; later markets reuse it and exclude all sibling versions.
 */
export const seasonFreeAgencyCanonicalSchema = z.object({
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  band: seasonFreeAgencyBandSchema,
  /** The window index that admitted this canonical choice. */
  admittedWindowIndex: z.number().int().min(0).max(2),
  /** Named seed path (`free-agency/{window}/canonical/{playerId}`). */
  seedPath: z.array(z.string()).min(1),
});
export type SeasonFreeAgencyCanonical = z.infer<typeof seasonFreeAgencyCanonicalSchema>;

/** One ordered interest target on a declaration. */
export const seasonFreeAgencyTargetSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  roleExpectation: seasonFreeAgencyRoleExpectationSchema,
  /** Committed Influence: candidate minimum through 3; debited only on a win. */
  influence: z.number().int().min(1).max(3),
});
export type SeasonFreeAgencyTarget = z.infer<typeof seasonFreeAgencyTargetSchema>;

/** One immutable declaration or skip (final once accepted). */
export const seasonFreeAgencyDeclarationSchema = z.object({
  franchiseId: franchiseIdSchema,
  windowIndex: z.number().int().min(0).max(2),
  /** The accepted command that recorded this declaration. */
  commandId: commandIdSchema,
  /** Ordered targets (1-2); empty means the franchise skipped. */
  targets: z.array(seasonFreeAgencyTargetSchema).min(0).max(2),
});
export type SeasonFreeAgencyDeclaration = z.infer<typeof seasonFreeAgencyDeclarationSchema>;

/**
 * One recorded comparison step in a resolution trace. Only categorical
 * results and cited facts survive: the UI explains who won and why without
 * exposing precise hidden team-value scores.
 */
export const seasonFreeAgencyTraceStepSchema = z.object({
  candidatePlayerVersionId: playerVersionIdSchema,
  /** The compared franchise (each step records one franchise's comparison). */
  franchiseId: franchiseIdSchema,
  criterion: z.enum([
    'legality',
    'role-credibility',
    'need',
    'identity-fit',
    'opportunity',
    'influence',
    'draw',
  ]),
  /** Categorical result, e.g. `legal`, `rotational`, `depth`, `emergency`, `immediate`, `available`, `crowded`, `tie`, `won`, `lost`. */
  category: z.string().min(1).max(32),
  /** Cited recorded facts (roster, health, standings, campaign, catalog). */
  citedFacts: z.array(z.string().min(1).max(256)).max(8),
});
export type SeasonFreeAgencyTraceStep = z.infer<typeof seasonFreeAgencyTraceStepSchema>;

/** The recorded trace of one resolution pass over the window's candidates. */
export const seasonFreeAgencyResolutionTraceSchema = z.object({
  windowIndex: z.number().int().min(0).max(2),
  /** Named seed path (`free-agency/{window}/resolve/...`). */
  seedPath: z.array(z.string()).min(1),
  /** Every comparison step, in candidate/franchise comparison order. */
  steps: z.array(seasonFreeAgencyTraceStepSchema),
  /** First-priority winners by candidate (may resolve no signing). */
  firstPriorityWinners: z.array(
    z.object({
      candidatePlayerVersionId: playerVersionIdSchema,
      winnerFranchiseId: franchiseIdSchema,
    }),
  ),
  /** Second-priority winners for franchises that did not sign. */
  secondPriorityWinners: z.array(
    z.object({
      candidatePlayerVersionId: playerVersionIdSchema,
      winnerFranchiseId: franchiseIdSchema,
    }),
  ),
  /** The franchise that signed this window, if any. */
  signingFranchiseId: franchiseIdSchema.nullable(),
  /** The signed candidate, if any. */
  signedPlayerVersionId: playerVersionIdSchema.nullable(),
  resolution: z.enum(['signed', 'no-signing']),
});
export type SeasonFreeAgencyResolutionTrace = z.infer<typeof seasonFreeAgencyResolutionTraceSchema>;

/**
 * One immutable signing. Links the ownership transfer, the debited ledger
 * entry, the transaction entry, and the producing command so every
 * accounting fact reconciles from recorded ids.
 */
export const seasonFreeAgencySigningSchema = z.object({
  signingId: idSchema,
  windowIndex: z.number().int().min(0).max(2),
  franchiseId: franchiseIdSchema,
  playerVersionId: playerVersionIdSchema,
  playerId: playerIdSchema,
  band: seasonFreeAgencyBandSchema,
  roleExpectation: seasonFreeAgencyRoleExpectationSchema,
  /** The debited commitment (candidate minimum through 3). */
  influenceCost: z.number().int().min(1).max(3),
  commandId: commandIdSchema,
  /** Named seed path of the resolution that produced the signing. */
  seedPath: z.array(z.string()).min(1),
  /** The ledger entry that recorded the Influence debit. */
  ledgerEntryId: idSchema,
  /** The immutable transaction entry for the signing. */
  transactionId: idSchema,
  /** The run stateRevision the signing applied at. */
  appliedAtStateRevision: z.number().int().nonnegative(),
});
export type SeasonFreeAgencySigning = z.infer<typeof seasonFreeAgencySigningSchema>;

/** Lifecycle of one shared market window. */
export const seasonFreeAgencyWindowStatusSchema = z.enum(['open', 'resolved']);
export type SeasonFreeAgencyWindowStatus = z.infer<typeof seasonFreeAgencyWindowStatusSchema>;

/**
 * One persisted market window. `candidates` carries the up-to-12 unique
 * identities admitted at open; `declarations` covers all 30 franchises
 * (deterministic AI declarations recorded at open, human declarations
 * recorded as commands arrive); `traces` and `signings` fill at resolution.
 */
export const seasonFreeAgencyWindowStateSchema = z
  .object({
    windowIndex: z.number().int().min(0).max(2),
    /** The accepted checkpoint (block index 2, 4, or 6) that opened it. */
    blockIndex: z.number().int().min(2).max(6),
    status: seasonFreeAgencyWindowStatusSchema,
    /** Unique eligible identities, at most 12 (smaller valid sets allowed). */
    candidates: z.array(seasonFreeAgencyCandidateSchema).min(1).max(12),
    /** All 30 franchise declarations, keyed by franchiseId. */
    declarations: z.record(franchiseIdSchema, seasonFreeAgencyDeclarationSchema),
    /** Recorded resolution traces (normally exactly one per window). */
    traces: z.array(seasonFreeAgencyResolutionTraceSchema),
    signings: z.array(seasonFreeAgencySigningSchema),
  })
  .superRefine((window, ctx) => {
    const versions = new Set<string>();
    const identities = new Set<string>();
    const featured = new Set<string>();
    for (const candidate of window.candidates) {
      if (versions.has(candidate.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate candidate version ${candidate.playerVersionId}`,
        });
      }
      versions.add(candidate.playerVersionId);
      if (identities.has(candidate.playerId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate candidate identity ${candidate.playerId}`,
        });
      }
      identities.add(candidate.playerId);
      if (candidate.band === 'featured') featured.add(candidate.playerId);
    }
    if (featured.size > 1) {
      ctx.addIssue({
        code: 'custom',
        message: `window must contain at most one featured candidate (found ${String(featured.size)})`,
      });
    }
    for (const signing of window.signings) {
      if (!versions.has(signing.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `signing ${signing.playerVersionId} is not a window candidate`,
        });
      }
    }
  });
export type SeasonFreeAgencyWindowState = z.infer<typeof seasonFreeAgencyWindowStateSchema>;

/**
 * The run-scoped free-agency state (schema 1, season-free-agency-v1): every
 * opened window, every persisted canonical identity choice, every
 * declaration, the resolution traces, the signings, per-franchise season
 * signing counts (max 3), and per-franchise season Influence spend on free
 * agency (max 6). Entered in the run state digest, the checkpoint, the
 * accepted command log, and the replay export.
 */
export const seasonFreeAgencyStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    freeAgencyVersion: z.literal(SEASON_FREE_AGENCY_VERSION),
    /** Every opened window, oldest first. */
    windows: z.array(seasonFreeAgencyWindowStateSchema).max(3),
    /** Every admitted canonical identity choice, keyed by playerId. */
    canonicalCandidates: z.record(playerIdSchema, seasonFreeAgencyCanonicalSchema),
    /** Per-franchise season signing counts (cap 3). */
    signingCounts: z.record(franchiseIdSchema, z.number().int().min(0).max(3)),
    /** Per-franchise season free-agency Influence spend (cap 6). */
    seasonSpend: z.record(franchiseIdSchema, z.number().int().min(0).max(6)),
  })
  .superRefine((state, ctx) => {
    if (Object.keys(state.signingCounts).length !== 30) {
      ctx.addIssue({
        code: 'custom',
        message: `free-agency signing counts must cover all 30 franchises (found ${String(Object.keys(state.signingCounts).length)})`,
      });
    }
    if (Object.keys(state.seasonSpend).length !== 30) {
      ctx.addIssue({
        code: 'custom',
        message: `free-agency season spend must cover all 30 franchises (found ${String(Object.keys(state.seasonSpend).length)})`,
      });
    }
  });
export type SeasonFreeAgencyState = z.infer<typeof seasonFreeAgencyStateSchema>;
