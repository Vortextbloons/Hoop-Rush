import {
  SEASON_AI_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_VERSION,
  playerVersionId,
  seasonDigestHex,
  type SeasonAiAssignment,
  type SeasonDraftCatalog,
  type SeasonDraftCatalogPool,
  type SeasonDraftCandidate,
  type SeasonDraftState,
  type SeasonLeague,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague } from './season.ts';

/**
 * Deterministic Season Run M2.1 fixture builders (spec/2.0 M2.1): a compact
 * draft catalog with position variety (so legality and feasibility are
 * exercisable), rotation builders, AI assignments, and synthetic
 * generation results. Engine tests, persistence tests, and CLI tests share
 * these so the contracts stay in sync.
 */

/** Position archetypes cycled across candidates so every pool covers G/F/C. */
const POSITION_ARCHETYPES: Array<{
  playable: Array<'PG' | 'SG' | 'SF' | 'PF' | 'C'>;
  primary: 'PG' | 'SG' | 'SF' | 'PF' | 'C';
}> = [
  { playable: ['PG'], primary: 'PG' },
  { playable: ['SG'], primary: 'SG' },
  { playable: ['PG', 'SG'], primary: 'PG' },
  { playable: ['SF'], primary: 'SF' },
  { playable: ['PF'], primary: 'PF' },
  { playable: ['SF', 'PF'], primary: 'SF' },
  { playable: ['SG', 'SF'], primary: 'SG' },
  { playable: ['C'], primary: 'C' },
  { playable: ['PF', 'C'], primary: 'PF' },
  { playable: ['SG', 'SF', 'PF'], primary: 'SG' },
];

function candidateRating(
  key:
    | 'insideScoring'
    | 'threePoint'
    | 'perimeterDefense'
    | 'interiorDefense'
    | 'offensiveRebound'
    | 'defensiveRebound'
    | 'ballHandling'
    | 'passing',
  archetypeIndex: number,
  n: number,
): number {
  const base = 40 + ((n * 7 + archetypeIndex * 3) % 45);
  const boosts: Record<string, number[]> = {
    insideScoring: [4, 2, 2, 6, 10, 10, 2, 14, 12, 8],
    threePoint: [8, 14, 10, 8, 2, 2, 12, 0, 2, 6],
    perimeterDefense: [6, 8, 8, 8, 4, 4, 6, 0, 2, 6],
    interiorDefense: [0, 0, 0, 4, 8, 8, 2, 14, 14, 6],
    offensiveRebound: [0, 0, 0, 4, 10, 10, 2, 12, 14, 4],
    defensiveRebound: [0, 0, 2, 6, 10, 10, 4, 14, 14, 6],
    ballHandling: [14, 4, 10, 2, 2, 0, 6, 0, 0, 4],
    passing: [12, 4, 8, 2, 2, 2, 6, 0, 2, 4],
  };
  const boost = boosts[key]?.[archetypeIndex] ?? 0;
  return Math.min(96, Math.max(25, base + boost));
}

/**
 * One deterministic draft candidate. The archetype index shapes the ratings so
 * scoring functions and feasibility searches see real variation.
 */
export function buildSeasonDraftCandidate(input: {
  franchiseId: string;
  eraId: string;
  index: number;
  poolIndex?: number;
}): SeasonDraftCandidate {
  const { franchiseId, eraId, index } = input;
  const archetype = POSITION_ARCHETYPES[index % POSITION_ARCHETYPES.length];
  if (!archetype) throw new Error('missing position archetype');
  const playerId = `p-d-${franchiseId}-${eraId}-${String(index)}`;
  const versionId = playerVersionId(playerId, franchiseId, eraId, '1995-96');
  const seasonKey = '1995-96';
  return {
    playerVersionId: versionId,
    playerId,
    franchiseId,
    eraId,
    seasonKey,
    displayName: `Fixture ${franchiseId} ${String(index)}`,
    playerExternalId: '101',
    positions: {
      primary: archetype.primary,
      secondary: [],
      playable: [...archetype.playable].sort(),
      normalizationVersion: 'position-v3',
    },
    heightInches: 78,
    weightLbs: 215,
    summaryRatings: {
      overallRating: 40 + ((index * 5) % 55),
      offenseRating: 40 + ((index * 6) % 55),
      defenseRating: 40 + ((index * 4) % 55),
    },
    detailedRatings: {
      insideScoring: candidateRating('insideScoring', index % POSITION_ARCHETYPES.length, index),
      closeShot: candidateRating('insideScoring', index % POSITION_ARCHETYPES.length, index) - 4,
      midrange: 45 + ((index * 3) % 40),
      threePoint: candidateRating('threePoint', index % POSITION_ARCHETYPES.length, index),
      freeThrow: 60 + ((index * 2) % 35),
      ballHandling: candidateRating('ballHandling', index % POSITION_ARCHETYPES.length, index),
      passing: candidateRating('passing', index % POSITION_ARCHETYPES.length, index),
      offensiveIq: 45 + ((index * 4) % 45),
      offensiveRebound: candidateRating(
        'offensiveRebound',
        index % POSITION_ARCHETYPES.length,
        index,
      ),
      defensiveRebound: candidateRating(
        'defensiveRebound',
        index % POSITION_ARCHETYPES.length,
        index,
      ),
      perimeterDefense: candidateRating(
        'perimeterDefense',
        index % POSITION_ARCHETYPES.length,
        index,
      ),
      interiorDefense: candidateRating(
        'interiorDefense',
        index % POSITION_ARCHETYPES.length,
        index,
      ),
      steal: 40 + ((index * 3) % 45),
      block: 40 + ((index * 3) % 45),
      defensiveIq: 40 + ((index * 3) % 45),
      speed: 50 + ((index * 3) % 45),
      strength: 45 + ((index * 3) % 45),
      vertical: 50 + ((index * 2) % 40),
    },
    tendencies: {
      usageRate: 15 + ((index * 2) % 25),
      passRate: 20 + ((index * 2) % 25),
      shotRate: 20 + ((index * 2) % 25),
      driveRate: 15 + ((index * 2) % 20),
      postUpRate: 5 + ((index * 2) % 25),
      rimFrequency: 20 + ((index * 2) % 30),
      shortMidFrequency: 15 + ((index * 2) % 20),
      longMidFrequency: 10 + ((index * 2) % 15),
      cornerThreeFrequency: 5 + ((index * 2) % 15),
      aboveBreakThreeFrequency: 8 + ((index * 2) % 18),
      threePointRate: 12 + ((index * 2) % 25),
      freeThrowRate: 18 + ((index * 2) % 15),
      turnoverRate: 10 + ((index * 2) % 10),
      isolationRate: 8 + ((index * 2) % 15),
      pickAndRollBallHandlerRate: 15 + ((index * 2) % 25),
      pickAndRollRollManRate: 5 + ((index * 2) % 20),
      spotUpRate: 12 + ((index * 2) % 22),
      transitionRate: 12 + ((index * 2) % 15),
      cutRate: 8 + ((index * 2) % 14),
      foulRate: 2 + (index % 4),
      stealAttemptRate: 6 + ((index * 2) % 12),
      blockAttemptRate: 6 + ((index * 2) % 14),
      crashOffensiveGlassRate: 8 + ((index * 2) % 18),
    },
  };
}

/**
 * Compact deterministic draft catalog. `playersPerPool` candidates per pool
 * cycle through the position archetypes, so every pool contains G/F/C variety
 * and completion targets stay feasible.
 */
export function buildSeasonDraftCatalog(
  input: {
    franchiseIds?: string[];
    eras?: string[];
    playersPerPool?: number;
  } = {},
): SeasonDraftCatalog {
  const franchiseIds = input.franchiseIds ?? ['lakers', 'celtics', 'bulls', 'warriors'];
  const eras = input.eras ?? ['1980s', '1990s', '2000s', '2010s'];
  const playersPerPool = input.playersPerPool ?? 12;
  const candidates: SeasonDraftCandidate[] = [];
  const pools: SeasonDraftCatalogPool[] = [];
  for (const franchiseId of franchiseIds) {
    for (const eraId of eras) {
      const members: string[] = [];
      for (let index = 0; index < playersPerPool; index += 1) {
        const candidate = buildSeasonDraftCandidate({ franchiseId, eraId, index });
        candidates.push(candidate);
        members.push(candidate.playerVersionId);
      }
      pools.push({ franchiseId, eraId, playerVersionIds: members });
    }
  }
  return {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_VERSION,
    dataVersion: 'm10-ratings-v3.4',
    ratingsVersion: 'ratings-v3.4',
    positionNormalizationVersion: 'position-v3',
    playerVersionIdVersion: 'player-version-id-v1',
    pools,
    candidates,
  };
}

/** Deterministic legal rotation over ten candidate versions (32/16 minutes). */
export function buildSeasonRotation(
  franchiseId: string,
  playerVersionIds: string[],
): SeasonRotation {
  if (playerVersionIds.length !== 10) throw new Error('rotation needs ten players');
  const starters = playerVersionIds.slice(0, 5);
  const bench = playerVersionIds.slice(5);
  return {
    franchiseId,
    starters,
    benchOrder: bench,
    targetMinutes: [
      ...starters.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...bench.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ],
    closingFive: starters,
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}

const BAND_CYCLE: Array<SeasonAiAssignment['band']> = [
  'contender',
  'contender',
  'contender',
  'contender',
  'playoff',
  'playoff',
  'playoff',
  'playoff',
  'playoff',
  'playoff',
  'playoff',
  'playoff',
  'average',
  'average',
  'average',
  'average',
  'average',
  'average',
  'average',
  'average',
  'average',
  'average',
  'weaker',
  'weaker',
  'weaker',
  'weaker',
  'weaker',
  'weaker',
  'weaker',
];

const IDENTITY_CYCLE: Array<SeasonAiAssignment['identity']> = [
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
];

/** Solo-quota band + identity assignments for all 30 franchises. */
export function buildSeasonAiAssignments(league: SeasonLeague): SeasonAiAssignment[] {
  return league.teams.map((team, index) => ({
    franchiseId: team.franchiseId,
    band: BAND_CYCLE[index] ?? 'average',
    identity: IDENTITY_CYCLE[index] ?? 'star-chaser',
  }));
}

/** Synthetic generation digest for fixture runs (deterministic helper). */
export function fixtureGenerationDigest(material: string): string {
  return seasonDigestHex(material).slice(0, 32);
}

/** Synthetic v2 M2.1 draft facts for fixture runs. */
export function buildFixtureSeasonDraftFacts(): SeasonRun['draft'] {
  return {
    draftVersion: SEASON_DRAFT_VERSION,
    participants: [
      {
        participantId: 'fixture-human',
        franchiseId: 'lakers',
        rolls: [{ franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true }],
        claims: [{ franchiseId: 'lakers', eraId: '1990s' }],
        picks: [],
      },
    ],
  };
}

/** Synthetic v2 generation audit for fixture runs. */
export function buildFixtureGenerationAudit(seed: string): SeasonRun['generationAudit'] {
  return {
    seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    rosterTargetsVersion: SEASON_ROSTER_TARGETS_VERSION,
    digest: fixtureGenerationDigest(`fixture-${seed}`),
    diagnostics: {
      seed,
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      teamsGenerated: 29,
      teamsRepaired: 0,
      backtracks: 0,
      nodesVisited: 29,
      nodeBudget: 100000,
      failedTeams: [],
      unmetConstraints: [],
    },
  };
}

/** Synthetic per-roster evaluations for fixture runs. */
export function buildFixtureEvaluations(
  rosters: SeasonRoster[],
  assignments: SeasonAiAssignment[],
): SeasonRun['evaluations'] {
  return rosters.map((roster) => {
    const assignment = assignments.find((a) => a.franchiseId === roster.franchiseId);
    return {
      franchiseId: roster.franchiseId,
      band: assignment?.band ?? 'average',
      identity: assignment?.identity ?? 'star-chaser',
      strengthScore: 55,
      roleScores: {
        'primary-creation': 55,
        'secondary-creation': 55,
        'perimeter-shooting': 55,
        'rim-finishing-interior-scoring': 55,
        'perimeter-defense': 55,
        'interior-defense': 55,
        'offensive-rebounding': 55,
        'defensive-rebounding': 55,
      },
      rolesCovered: [
        'primary-creation',
        'secondary-creation',
        'perimeter-shooting',
        'rim-finishing-interior-scoring',
        'perimeter-defense',
        'interior-defense',
        'offensive-rebounding',
        'defensive-rebounding',
      ],
      overallReport: 70,
    };
  });
}

/**
 * Valid draft-state fixture for persistence and CLI tests. The state is
 * schema-valid (mid-drafting with one claim and one pick); tests that need
 * specific shapes pass shallow overrides.
 */
export function buildSeasonDraftState(
  overrides: Partial<SeasonRun['draft']> & { rootSeed?: string; revision?: number } = {},
): SeasonDraftState {
  return {
    schemaVersion: 1,
    draftVersion: SEASON_DRAFT_VERSION,
    runId: 'fixture-draft-1',
    rootSeed: overrides.rootSeed ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    league: buildSeasonLeague(),
    catalogVersion: SEASON_DRAFT_VERSION,
    participants: [
      { participantId: 'human-1', franchiseId: 'lakers' },
      { participantId: 'human-2', franchiseId: 'celtics' },
    ],
    firstPickParticipantId: 'human-1',
    round: 2,
    currentTurnParticipantId: 'human-2',
    status: 'drafting',
    revision: overrides.revision ?? 3,
    currentReveal: {
      participantId: 'human-2',
      round: 2,
      pickOrdinal: 2,
      attempts: [{ franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true }],
    },
    rolls: [{ franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true }],
    claims: [{ participantId: 'human-1', franchiseId: 'lakers', eraId: '1990s' }],
    picks: [
      {
        participantId: 'human-1',
        round: 1,
        pickOrdinal: 1,
        playerVersionId: `pv-${'0'.repeat(32)}`,
        franchiseId: 'lakers',
        eraId: '1990s',
        rollAttempts: 1,
      },
    ],
    commandLog: [
      {
        status: 'accepted',
        commandId: 'c-create',
        revisionBefore: 0,
        revisionAfter: 1,
        stateDigest: '0'.repeat(32),
        command: {
          commandId: 'c-create',
          expectedRevision: 0,
          payload: {
            kind: 'create-season-draft',
            runId: 'fixture-draft-1',
            rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
            league: buildSeasonLeague(),
            humanParticipantIds: ['human-1', 'human-2'],
            catalogVersion: SEASON_DRAFT_VERSION,
          },
        },
      },
      {
        status: 'accepted',
        commandId: 'c-reveal-1',
        revisionBefore: 1,
        revisionAfter: 2,
        stateDigest: '0'.repeat(32),
        command: {
          commandId: 'c-reveal-1',
          expectedRevision: 1,
          payload: { kind: 'reveal-draft-roll', participantId: 'human-1' },
        },
      },
      {
        status: 'accepted',
        commandId: 'c-claim-1',
        revisionBefore: 2,
        revisionAfter: 3,
        stateDigest: '0'.repeat(32),
        command: {
          commandId: 'c-claim-1',
          expectedRevision: 2,
          payload: {
            kind: 'claim-draft-pool',
            participantId: 'human-1',
            franchiseId: 'lakers',
            eraId: '1990s',
          },
        },
      },
    ],
  };
}
