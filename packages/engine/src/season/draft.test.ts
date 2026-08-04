import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  seasonDraftStateSchema,
  seasonLeagueGenerationResultSchema,
  seasonNamespaceSeed,
  seasonDigestHex,
  type SeasonDraftCatalog,
  type SeasonDraftCandidate,
  type SeasonDraftCommand,
  type SeasonDraftCommandRecord,
  type SeasonDraftState,
  type SeasonDraftAcceptedRecord,
  type SeasonDraftRejectedRecord,
  type SeasonLeague,
  type SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';
import {
  buildSeasonAiAssignments,
  buildSeasonDraftCandidate,
  buildSeasonDraftCatalog,
  buildSeasonLeague,
  buildSeasonRotation,
  buildFixtureEvaluations,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import {
  applySeasonDraftCommand,
  seasonDraftStateCanonical,
  type SeasonAiGenerationDeps,
  type SeasonAiGenerationInput,
} from './draft.js';
import { seasonGenerationDigest } from './digest.js';
import { SeasonAiGenerationError } from './ai.js';
import { createRng } from '../sim/rng.js';

/**
 * Season Run M2.1 human draft domain tests: one- and two-human creation,
 * seeded first pick, snake reversal, exact-pair claims, invalid-pool
 * recovery, idempotency, stale revisions, rejected-command logging,
 * same-person/different-version legality, completion feasibility, and
 * byte-for-byte replay.
 */

const CATALOG = buildSeasonDraftCatalog();
/** Large catalog: enough pools (32) and candidates (640) for two humans + AI. */
const FULL_CATALOG = buildSeasonDraftCatalog({
  franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
  eras: ['1980s', '1990s', '2000s', '2010s'],
  playersPerPool: 20,
});
const LEAGUE = buildSeasonLeague();
const SEED = seedFromString('draft-test-seed');

function cmd(
  commandId: string,
  expectedRevision: number,
  payload: SeasonDraftCommand['payload'],
): SeasonDraftCommand {
  return { commandId, expectedRevision, payload };
}

function expectAccepted(record: SeasonDraftCommandRecord): SeasonDraftAcceptedRecord {
  if (record.status !== 'accepted') {
    throw new Error(`expected an accepted record, got rejected: ${record.message}`);
  }
  return record;
}

function expectRejected(record: SeasonDraftCommandRecord): SeasonDraftRejectedRecord {
  if (record.status !== 'rejected') {
    throw new Error('expected a rejected record');
  }
  return record;
}

function requireState(state: SeasonDraftState | null, what: string): SeasonDraftState {
  if (state === null) throw new Error(`expected state after ${what}`);
  return state;
}

/** Canonical facts without the command log (rejected entries differ by design). */
function canonicalFacts(state: SeasonDraftState): string {
  return seasonDraftStateCanonical({ ...state, commandLog: [] });
}

/** Fake generation dep that builds a deterministic valid result from the input. */
function fakeDeps(): SeasonAiGenerationDeps {
  return { generate: (input) => buildFakeGeneration(input) };
}

function buildFakeGeneration(input: SeasonAiGenerationInput): SeasonLeagueGenerationResult {
  const owned = new Set<string>();
  const rosters = input.league.teams.map((team) => {
    const human = input.humanRosters.find((r) => r.franchiseId === team.franchiseId);
    const players =
      human !== undefined
        ? human.playerVersionIds
        : (() => {
            const available = input.catalog.candidates.filter((c) => !owned.has(c.playerVersionId));
            return available.slice(0, 10).map((c) => c.playerVersionId);
          })();
    for (const versionId of players) owned.add(versionId);
    const resolved = players.map((playerVersionId) => {
      const candidate = input.catalog.candidates.find((c) => c.playerVersionId === playerVersionId);
      if (!candidate) throw new Error('fake generation: missing candidate');
      return {
        playerVersionId,
        playerId: candidate.playerId,
        franchiseId: candidate.franchiseId,
        eraId: candidate.eraId,
        seasonKey: candidate.seasonKey,
        displayName: candidate.displayName,
      };
    });
    return { franchiseId: team.franchiseId, players: resolved };
  });
  const ownership = rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      ownerFranchiseId: roster.franchiseId,
    })),
  );
  const rotations = rosters.map((roster) =>
    buildSeasonRotation(
      roster.franchiseId,
      roster.players.map((p) => p.playerVersionId),
    ),
  );
  const aiAssignments = buildSeasonAiAssignments(input.league);
  const evaluations = buildFixtureEvaluations(rosters, aiAssignments);
  const diagnostics = {
    seed: input.seed,
    aiVersion: 'season-ai-v1',
    rosterGenerationVersion: 'roster-generation-v1',
    teamsGenerated: 29,
    teamsRepaired: 0,
    backtracks: 0,
    nodesVisited: 29,
    nodeBudget: 100000,
    failedTeams: [] as string[],
    unmetConstraints: [] as string[],
  };
  const digest = seasonGenerationDigest({
    seed: input.seed,
    aiVersion: 'season-ai-v1',
    rosterGenerationVersion: 'roster-generation-v1',
    rotationVersion: 'season-rotation-v1',
    rosters,
    ownership,
    rotations,
    aiAssignments,
  });
  return seasonLeagueGenerationResultSchema.parse({
    schemaVersion: 1,
    seed: input.seed,
    aiVersion: 'season-ai-v1',
    rosterGenerationVersion: 'roster-generation-v1',
    rotationVersion: 'season-rotation-v1',
    rosters,
    ownership,
    rotations,
    aiAssignments,
    evaluations,
    diagnostics,
    digest,
  });
}

function createSolo(
  catalog: SeasonDraftCatalog = CATALOG,
  league: SeasonLeague = LEAGUE,
  rootSeed = SEED,
) {
  return applySeasonDraftCommand(
    null,
    catalog,
    cmd('c-create', 0, {
      kind: 'create-season-draft',
      runId: 'run-1',
      rootSeed,
      league,
      humanParticipantIds: ['p1'],
      catalogVersion: 'season-draft-v1',
    }),
    fakeDeps(),
  );
}

function createDuo(
  catalog: SeasonDraftCatalog = FULL_CATALOG,
  league: SeasonLeague = LEAGUE,
  rootSeed = SEED,
) {
  return applySeasonDraftCommand(
    null,
    catalog,
    cmd('c-create', 0, {
      kind: 'create-season-draft',
      runId: 'run-1',
      rootSeed,
      league,
      humanParticipantIds: ['p1', 'p2'],
      catalogVersion: 'season-draft-v1',
    }),
    fakeDeps(),
  );
}

function pickBest(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  commandId: string,
): SeasonDraftState {
  const reveal = state.currentReveal;
  if (reveal === null) return state;
  const last = reveal.attempts[reveal.attempts.length - 1];
  if (!last?.usable) return state;
  const owned = new Set(state.picks.map((p) => p.playerVersionId));
  const candidates = catalog.candidates
    .filter(
      (c) =>
        c.franchiseId === last.franchiseId &&
        c.eraId === last.eraId &&
        !owned.has(c.playerVersionId),
    )
    .sort(
      (a, b) =>
        b.summaryRatings.overallRating - a.summaryRatings.overallRating ||
        a.playerVersionId.localeCompare(b.playerVersionId),
    );
  for (const candidate of candidates) {
    const result = applySeasonDraftCommand(
      state,
      catalog,
      cmd(commandId, state.revision, {
        kind: 'select-draft-player',
        participantId: reveal.participantId,
        playerVersionId: candidate.playerVersionId,
      }),
      fakeDeps(),
    );
    if (result.record.status === 'accepted') return requireState(result.state, 'pick');
  }
  throw new Error('pickBest: no legal pick found');
}

/** Plays a complete draft: reveal, claim, best pick until finalized+generated. */
function playToFinalized(
  catalog: SeasonDraftCatalog,
  league: SeasonLeague,
  rootSeed: string,
  deps: SeasonAiGenerationDeps,
  ids: string[],
  commandIdPrefix: string,
): SeasonDraftState {
  const created = applySeasonDraftCommand(
    null,
    catalog,
    cmd(`${commandIdPrefix}-create`, 0, {
      kind: 'create-season-draft',
      runId: 'run-1',
      rootSeed,
      league,
      humanParticipantIds: ids,
      catalogVersion: 'season-draft-v1',
    }),
    deps,
  );
  expectAccepted(created.record);
  let state = requireState(created.state, 'create');
  let sequence = 0;
  while (state.status === 'drafting' && state.currentTurnParticipantId !== null) {
    const pid = state.currentTurnParticipantId;
    const revealed = applySeasonDraftCommand(
      state,
      catalog,
      cmd(`${commandIdPrefix}-reveal-${String(sequence)}`, state.revision, {
        kind: 'reveal-draft-roll',
        participantId: pid,
      }),
      deps,
    );
    expectAccepted(revealed.record);
    state = requireState(revealed.state, 'reveal');
    const reveal = state.currentReveal;
    if (reveal === null) throw new Error('no reveal');
    const last = reveal.attempts[reveal.attempts.length - 1];
    if (!last) throw new Error('no reveal attempts');
    const claimed = applySeasonDraftCommand(
      state,
      catalog,
      cmd(`${commandIdPrefix}-claim-${String(sequence)}`, state.revision, {
        kind: 'claim-draft-pool',
        participantId: pid,
        franchiseId: last.franchiseId,
        eraId: last.eraId,
      }),
      deps,
    );
    expectAccepted(claimed.record);
    state = pickBest(
      requireState(claimed.state, 'claim'),
      catalog,
      `${commandIdPrefix}-pick-${String(sequence)}`,
    );
    sequence += 1;
  }
  const finalized = applySeasonDraftCommand(
    state,
    catalog,
    cmd(`${commandIdPrefix}-finalize`, state.revision, { kind: 'finalize-human-rosters' }),
    deps,
  );
  expectAccepted(finalized.record);
  return requireState(finalized.state, 'finalize');
}

function playFullDraft(
  catalog: SeasonDraftCatalog,
  league: SeasonLeague,
  rootSeed: string,
  deps: SeasonAiGenerationDeps,
  ids: string[],
  commandIdPrefix: string,
): { state: SeasonDraftState; generation: SeasonLeagueGenerationResult } {
  const finalized = playToFinalized(catalog, league, rootSeed, deps, ids, commandIdPrefix);
  const generated = applySeasonDraftCommand(
    finalized,
    catalog,
    cmd(`${commandIdPrefix}-generate`, finalized.revision, { kind: 'generate-ai-league' }),
    deps,
  );
  expectAccepted(generated.record);
  return {
    state: requireState(generated.state, 'generate'),
    generation: generated.generation as SeasonLeagueGenerationResult,
  };
}

/**
 * Custom catalog: each entry lists the playable positions of every candidate
 * in the pool (length 12), so per-candidate roles are controllable. Filler
 * pools (no centers) are appended so one-human creation passes.
 */
function customCatalog(
  entries: Array<{ franchiseId: string; eraId: string; positions: string[][] }>,
): SeasonDraftCatalog {
  const used = new Set(entries.map((e) => `${e.franchiseId}/${e.eraId}`));
  const FILLERS = [
    ['knicks', '1990s'],
    ['spurs', '1990s'],
    ['jazz', '1990s'],
    ['nets', '1990s'],
    ['magic', '1990s'],
    ['suns', '1990s'],
    ['blazers', '1990s'],
    ['rockets', '1990s'],
    ['clippers', '1990s'],
    ['pelicans', '1990s'],
  ] as const;
  const allEntries: typeof entries = [...entries];
  for (const [franchiseId, eraId] of FILLERS) {
    if (used.has(`${franchiseId}/${eraId}`)) continue;
    if (allEntries.length >= 10) break;
    allEntries.push({
      franchiseId,
      eraId,
      positions: [
        ['PG'],
        ['PG'],
        ['PG'],
        ['PG'],
        ['PG'],
        ['PG'],
        ['SF'],
        ['SF'],
        ['SF'],
        ['SF'],
        ['SF'],
        ['SF'],
      ],
    });
    used.add(`${franchiseId}/${eraId}`);
  }
  const candidates: SeasonDraftCandidate[] = [];
  const pools: SeasonDraftCatalog['pools'] = [];
  for (const entry of allEntries) {
    if (entry.positions.length !== 12) {
      throw new Error('customCatalog pool needs exactly 12 per-candidate position lists');
    }
    const members: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const playable = entry.positions[i];
      if (!playable || playable.length === 0) throw new Error('customCatalog missing positions');
      const playerId = `p-c-${entry.franchiseId}-${entry.eraId}-${String(i)}`;
      const candidate = buildSeasonDraftCandidate({
        franchiseId: entry.franchiseId,
        eraId: entry.eraId,
        index: i,
      });
      candidate.playerId = playerId;
      candidate.playerVersionId = `pv-${seasonDigestHex(`cand-${playerId}`)}`;
      candidate.positions.playable = [...playable] as SeasonDraftCandidate['positions']['playable'];
      candidate.positions.primary = playable[0] as SeasonDraftCandidate['positions']['primary'];
      candidate.positions.secondary = playable.slice(
        1,
      ) as SeasonDraftCandidate['positions']['secondary'];
      candidates.push(candidate);
      members.push(candidate.playerVersionId);
    }
    pools.push({ franchiseId: entry.franchiseId, eraId: entry.eraId, playerVersionIds: members });
  }
  return { ...buildSeasonDraftCatalog(), pools, candidates };
}

/**
 * Hand-builds a state with 9 picks from pool B: 4 guards, 2 forwards, one
 * PF/C hybrid, and two centers — group counts G4 F3 C3 with one pick left.
 */
function stateWithNinePicks(catalog: SeasonDraftCatalog, rootSeed: string): SeasonDraftState {
  const created = createSolo(catalog, LEAGUE, rootSeed);
  expectAccepted(created.record);
  const state = requireState(created.state, 'create');
  const pool = catalog.candidates.filter((c) => c.franchiseId === 'celtics');
  // Indices 0-3 PG, 4-5 SF, 6 PF/C, 7-8 C.
  const picks = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    .map((i) => pool[i])
    .filter((c): c is SeasonDraftCandidate => c !== undefined);
  if (picks.length !== 9) throw new Error('expected nine hand picks');
  const handPicks = picks.map((c, i) => ({
    participantId: 'p1',
    round: i + 1,
    pickOrdinal: i + 1,
    playerVersionId: c.playerVersionId,
    franchiseId: c.franchiseId,
    eraId: c.eraId,
    rollAttempts: 1,
  }));
  return seasonDraftStateSchema.parse({
    ...state,
    picks: handPicks,
    revision: 10,
    round: 10,
    currentReveal: null,
    commandLog: state.commandLog,
  });
}

describe('season draft create', () => {
  it('creates a one-human draft with a seeded franchise assignment', () => {
    const result = createSolo();
    expectAccepted(result.record);
    const state = requireState(result.state, 'create');
    expect(seasonDraftStateSchema.parse(state).status).toBe('drafting');
    expect(state.participants).toHaveLength(1);
    expect(state.participants[0]?.participantId).toBe('p1');
    expect(state.participants[0]?.franchiseId).toBeTruthy();
    expect(state.firstPickParticipantId).toBe('p1');
    expect(state.currentTurnParticipantId).toBe('p1');
    expect(state.round).toBe(1);
    expect(state.revision).toBe(1);
    expect(result.record).toMatchObject({
      status: 'accepted',
      revisionBefore: 0,
      revisionAfter: 1,
    });
  });

  it('creates a two-human draft with distinct franchise assignments', () => {
    const result = createDuo();
    const state = requireState(result.state, 'create');
    const franchises = state.participants.map((p) => p.franchiseId);
    expect(franchises).toHaveLength(2);
    expect(new Set(franchises).size).toBe(2);
    expect(['p1', 'p2']).toContain(state.firstPickParticipantId);
    expect(state.currentTurnParticipantId).toBe(state.firstPickParticipantId);
  });

  it('is deterministic for the same seed and different for another seed', () => {
    const a = createSolo(CATALOG, LEAGUE, SEED);
    const b = createSolo(CATALOG, LEAGUE, SEED);
    expect(seasonDraftStateCanonical(requireState(a.state, 'create'))).toBe(
      seasonDraftStateCanonical(requireState(b.state, 'create')),
    );
    const c = createSolo(CATALOG, LEAGUE, seedFromString('another-seed'));
    expect(seasonDraftStateCanonical(requireState(c.state, 'create'))).not.toBe(
      seasonDraftStateCanonical(requireState(a.state, 'create')),
    );
  });

  it('rejects creation when a draft already exists', () => {
    const first = createSolo();
    const result = applySeasonDraftCommand(
      first.state,
      CATALOG,
      cmd('c-create-2', first.state?.revision ?? 0, {
        kind: 'create-season-draft',
        runId: 'run-2',
        rootSeed: SEED,
        league: LEAGUE,
        humanParticipantIds: ['p1'],
        catalogVersion: 'season-draft-v1',
      }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('STALE_REVISION');
  });

  it('rejects non-create commands before any draft exists', () => {
    const result = applySeasonDraftCommand(
      null,
      CATALOG,
      cmd('c-reveal', 0, { kind: 'reveal-draft-roll', participantId: 'p1' }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('INVALID_CATALOG');
  });

  it('rejects an invalid catalog and an invalid league', () => {
    const badCatalog = { ...CATALOG, catalogVersion: 'season-draft-v9' };
    const result = applySeasonDraftCommand(
      null,
      badCatalog as SeasonDraftCatalog,
      cmd('c-create', 0, {
        kind: 'create-season-draft',
        runId: 'run-1',
        rootSeed: SEED,
        league: LEAGUE,
        humanParticipantIds: ['p1'],
        catalogVersion: 'season-draft-v1',
      }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('INVALID_CATALOG');

    const badLeague = { ...LEAGUE, teams: LEAGUE.teams.slice(0, 29) };
    const result2 = applySeasonDraftCommand(
      null,
      CATALOG,
      cmd('c-create-2', 0, {
        kind: 'create-season-draft',
        runId: 'run-1',
        rootSeed: SEED,
        league: badLeague,
        humanParticipantIds: ['p1'],
        catalogVersion: 'season-draft-v1',
      }),
      fakeDeps(),
    );
    expect(expectRejected(result2.record).errorCode).toBe('INVALID_CATALOG');
  });

  it('rejects creation when the catalog has too few claimable pools', () => {
    const small = buildSeasonDraftCatalog({
      franchiseIds: ['lakers'],
      eras: ['1990s'],
      playersPerPool: 12,
    });
    const result = applySeasonDraftCommand(
      null,
      small,
      cmd('c-create', 0, {
        kind: 'create-season-draft',
        runId: 'run-1',
        rootSeed: SEED,
        league: LEAGUE,
        humanParticipantIds: ['p1', 'p2'],
        catalogVersion: 'season-draft-v1',
      }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('UNCOMPLETABLE_ROSTER');
  });

  it('rejects duplicate participant ids', () => {
    const result = applySeasonDraftCommand(
      null,
      CATALOG,
      cmd('c-create', 0, {
        kind: 'create-season-draft',
        runId: 'run-1',
        rootSeed: SEED,
        league: LEAGUE,
        humanParticipantIds: ['p1', 'p1'],
        catalogVersion: 'season-draft-v1',
      }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('INVALID_CATALOG');
  });
});

describe('season draft rolls and recovery', () => {
  it('reveals a deterministic pool with recorded roll attempts', () => {
    const state = requireState(createSolo().state, 'create');
    const revealed = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-reveal-1', 1, { kind: 'reveal-draft-roll', participantId: 'p1' }),
      fakeDeps(),
    );
    expectAccepted(revealed.record);
    const next = requireState(revealed.state, 'reveal');
    const reveal = next.currentReveal;
    expect(reveal?.attempts.length).toBeGreaterThanOrEqual(1);
    expect(reveal?.attempts[reveal.attempts.length - 1]?.usable).toBe(true);
    expect(next.rolls.length).toBe(reveal?.attempts.length);
    // Re-revealing the same turn is an accepted no-op with the same pool.
    const again = applySeasonDraftCommand(
      next,
      CATALOG,
      cmd('c-reveal-1b', next.revision, { kind: 'reveal-draft-roll', participantId: 'p1' }),
      fakeDeps(),
    );
    expectAccepted(again.record);
    expect(again.state?.currentReveal?.attempts).toEqual(reveal?.attempts);
  });

  it('rejects reveal for the wrong participant', () => {
    const state = requireState(createDuo().state, 'create');
    const result = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-reveal', 1, { kind: 'reveal-draft-roll', participantId: 'p2' }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('WRONG_TURN');
  });

  it('records recovery attempts when the rolled pool is unusable', () => {
    // Pool A: pure centers only. Pool B: four guards, two forwards, one PF/C
    // hybrid, and two centers. Owned (9 picks): G4 F3 C3 with one pick left.
    // Selecting any pure center from pool A leaves the forwards short, so
    // pool A must be skipped by recovery; pool B's forward candidates finish
    // the completion target.
    const catalog = customCatalog([
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        positions: [
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
        ],
      },
      {
        franchiseId: 'celtics',
        eraId: '1990s',
        positions: [
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['SF'],
          ['SF'],
          ['PF', 'C'],
          ['C'],
          ['C'],
          ['PG'],
          ['SF'],
          ['PF', 'C'],
        ],
      },
    ]);
    let state = stateWithNinePicks(catalog, seedFromString('recovery-seed'));
    // Choose a root seed whose attempt-0 roll lands on the all-center pool.
    const allPools = catalog.pools.sort(
      (a, b) => a.franchiseId.localeCompare(b.franchiseId) || a.eraId.localeCompare(b.eraId),
    );
    let recoverySeed = seedFromString('recovery-seed');
    let hit = false;
    for (let i = 0; i < 300 && !hit; i += 1) {
      const candidateSeed = seedFromString(`recovery-${String(i)}`);
      const rolled = createRng(
        seasonNamespaceSeed(candidateSeed, 'draft', 'roll', 'p1', '10', '10', '0'),
      ).pick(allPools);
      if (rolled.franchiseId === 'lakers') {
        recoverySeed = candidateSeed;
        hit = true;
      }
    }
    expect(hit).toBe(true);
    state = seasonDraftStateSchema.parse({ ...state, rootSeed: recoverySeed });
    const revealed = applySeasonDraftCommand(
      state,
      catalog,
      cmd('c-reveal-10', 10, { kind: 'reveal-draft-roll', participantId: 'p1' }),
      fakeDeps(),
    );
    expectAccepted(revealed.record);
    const reveal = revealed.state?.currentReveal;
    expect(reveal?.attempts[0]).toMatchObject({ franchiseId: 'lakers', usable: false });
    expect(reveal?.attempts[1]?.usable).toBe(true);
    expect(reveal?.attempts[1]?.franchiseId).not.toBe('lakers');
    expect(reveal?.attempts).toHaveLength(2);
    expect(revealed.state?.rolls.filter((r) => !r.usable)).toHaveLength(1);
  });

  it('rejects reveal when no unclaimed pool remains', () => {
    const state = requireState(
      createSolo(CATALOG, LEAGUE, seedFromString('no-pools')).state,
      'create',
    );
    const claims = CATALOG.pools.map((pool) => ({
      participantId: 'p1',
      franchiseId: pool.franchiseId,
      eraId: pool.eraId,
    }));
    const allClaimed = seasonDraftStateSchema.parse({
      ...state,
      claims,
      revision: 17,
      commandLog: state.commandLog,
    });
    const result = applySeasonDraftCommand(
      allClaimed,
      CATALOG,
      cmd('c-reveal', 17, { kind: 'reveal-draft-roll', participantId: 'p1' }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('UNCOMPLETABLE_ROSTER');
  });
});

describe('season draft claims', () => {
  it('claims the revealed pool and rejects any other pair', () => {
    const state = requireState(createDuo().state, 'create');
    const revealed = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-reveal', 1, { kind: 'reveal-draft-roll', participantId: 'p1' }),
      fakeDeps(),
    );
    const next = requireState(revealed.state, 'reveal');
    const reveal = next.currentReveal;
    const last = reveal?.attempts[reveal.attempts.length - 1];
    if (!last) throw new Error('no reveal');
    const wrong = applySeasonDraftCommand(
      next,
      CATALOG,
      cmd('c-claim-wrong', next.revision, {
        kind: 'claim-draft-pool',
        participantId: 'p1',
        franchiseId: last.franchiseId === 'lakers' ? 'celtics' : 'lakers',
        eraId: last.eraId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(wrong.record).errorCode).toBe('UNAVAILABLE_POOL');
    const ok = applySeasonDraftCommand(
      next,
      CATALOG,
      cmd('c-claim', next.revision, {
        kind: 'claim-draft-pool',
        participantId: 'p1',
        franchiseId: last.franchiseId,
        eraId: last.eraId,
      }),
      fakeDeps(),
    );
    expectAccepted(ok.record);
    expect(ok.state?.claims).toContainEqual({
      participantId: 'p1',
      franchiseId: last.franchiseId,
      eraId: last.eraId,
    });
    // Re-claiming the same pool is an accepted no-op.
    const again = applySeasonDraftCommand(
      requireState(ok.state, 'claim'),
      CATALOG,
      cmd('c-claim-again', ok.state?.revision ?? 1, {
        kind: 'claim-draft-pool',
        participantId: 'p1',
        franchiseId: last.franchiseId,
        eraId: last.eraId,
      }),
      fakeDeps(),
    );
    expectAccepted(again.record);
    expect(again.state?.claims).toHaveLength(1);
  });

  it('rejects claim before a reveal and for the wrong participant', () => {
    const state = requireState(createDuo().state, 'create');
    const noReveal = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-claim', 1, {
        kind: 'claim-draft-pool',
        participantId: 'p1',
        franchiseId: 'lakers',
        eraId: '1990s',
      }),
      fakeDeps(),
    );
    expect(expectRejected(noReveal.record).errorCode).toBe('UNAVAILABLE_POOL');
    const wrongTurn = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-claim-2', 1, {
        kind: 'claim-draft-pool',
        participantId: 'p2',
        franchiseId: 'lakers',
        eraId: '1990s',
      }),
      fakeDeps(),
    );
    expect(expectRejected(wrongTurn.record).errorCode).toBe('WRONG_TURN');
  });

  it('never rolls a claimed pool for either participant', () => {
    const { state } = playFullDraft(
      FULL_CATALOG,
      LEAGUE,
      seedFromString('claims-run'),
      fakeDeps(),
      ['p1', 'p2'],
      'cd',
    );
    // Claims and roll attempts are both chronological. Each reveal's attempts
    // precede its own claim, so reveal k must never contain a pair claimed in
    // an earlier turn (claims[0..k-1]).
    const reveals = state.commandLog
      .filter((r) => r.status === 'accepted')
      .map((r) =>
        r.command.payload.kind === 'reveal-draft-roll' ? r.command.payload.participantId : null,
      )
      .filter((pid): pid is string => pid !== null);
    const claimPairs = state.claims.map((c) => `${c.franchiseId}/${c.eraId}`);
    const revealGroups: Array<string[]> = [];
    let group: string[] = [];
    for (const attempt of state.rolls) {
      group.push(`${attempt.franchiseId}/${attempt.eraId}`);
      if (attempt.usable) {
        revealGroups.push(group);
        group = [];
      }
    }
    if (group.length > 0) revealGroups.push(group);
    expect(revealGroups.length).toBe(reveals.length);
    revealGroups.forEach((attempts, k) => {
      for (const pair of attempts) {
        expect(claimPairs.slice(0, k)).not.toContain(pair);
      }
    });
    // Every revealed pair was claimed exactly once by its revealer.
    for (const pair of claimPairs) {
      expect(revealGroups.flat().filter((p) => p === pair)).toHaveLength(1);
    }
  });
});

describe('season draft picks', () => {
  it('picks a legal player, advances the snake, and clears the reveal', () => {
    const state = requireState(createDuo().state, 'create');
    const first = state.firstPickParticipantId;
    const other = first === 'p1' ? 'p2' : 'p1';
    const revealed = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-reveal', 1, { kind: 'reveal-draft-roll', participantId: first }),
      fakeDeps(),
    );
    const next = pickBest(requireState(revealed.state, 'reveal'), CATALOG, 'c-pick-1');
    expect(next.picks).toHaveLength(1);
    expect(next.currentReveal).toBeNull();
    expect(next.currentTurnParticipantId).toBe(other);
    expect(next.round).toBe(1);
  });

  it('rejects picks for the wrong turn, out-of-pool, owned, and infeasible versions', () => {
    const state = requireState(createDuo().state, 'create');
    const first = state.firstPickParticipantId;
    const revealed = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-reveal', 1, { kind: 'reveal-draft-roll', participantId: first }),
      fakeDeps(),
    );
    const next = requireState(revealed.state, 'reveal');
    const last = next.currentReveal?.attempts[next.currentReveal.attempts.length - 1];
    if (!last) throw new Error('no reveal');
    const inPool = CATALOG.candidates.find(
      (c) => c.franchiseId === last.franchiseId && c.eraId === last.eraId,
    );
    const outOfPool = CATALOG.candidates.find(
      (c) => c.franchiseId !== last.franchiseId || c.eraId !== last.eraId,
    );
    if (!inPool || !outOfPool) throw new Error('candidates missing');
    const wrongTurn = applySeasonDraftCommand(
      next,
      CATALOG,
      cmd('c-pick-wrong', next.revision, {
        kind: 'select-draft-player',
        participantId: first === 'p1' ? 'p2' : 'p1',
        playerVersionId: inPool.playerVersionId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(wrongTurn.record).errorCode).toBe('WRONG_TURN');
    const outside = applySeasonDraftCommand(
      next,
      CATALOG,
      cmd('c-pick-out', next.revision, {
        kind: 'select-draft-player',
        participantId: first,
        playerVersionId: outOfPool.playerVersionId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(outside.record).errorCode).toBe('UNAVAILABLE_POOL');
    const picked = applySeasonDraftCommand(
      next,
      CATALOG,
      cmd('c-pick-ok', next.revision, {
        kind: 'select-draft-player',
        participantId: first,
        playerVersionId: inPool.playerVersionId,
      }),
      fakeDeps(),
    );
    expectAccepted(picked.record);
    // OWNED_VERSION is defense-in-depth: the command path can never re-reveal
    // a claimed pool, so hand-build a state where the same participant holds
    // a reveal containing a version they already own.
    const afterPick = requireState(picked.state, 'pick');
    const ownedTurn = seasonDraftStateSchema.parse({
      ...afterPick,
      currentTurnParticipantId: first,
      round: 2,
      currentReveal: {
        participantId: first,
        round: 2,
        pickOrdinal: 2,
        attempts: [
          { franchiseId: last.franchiseId, eraId: last.eraId, attemptIndex: 0, usable: true },
        ],
      },
      rolls: [
        ...afterPick.rolls,
        { franchiseId: last.franchiseId, eraId: last.eraId, attemptIndex: 0, usable: true },
      ],
    });
    const ownedAgain = applySeasonDraftCommand(
      ownedTurn,
      CATALOG,
      cmd('c-pick-owned', ownedTurn.revision, {
        kind: 'select-draft-player',
        participantId: first,
        playerVersionId: inPool.playerVersionId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(ownedAgain.record).errorCode).toBe('OWNED_VERSION');
  });

  it('rejects a pick that makes completion infeasible', () => {
    // Owned (9 picks): G4 F3 C3 with one pick left and pool A revealed
    // (pure centers). Picking another center leaves the forwards short, so
    // the pick must be rejected.
    const catalog = customCatalog([
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        positions: [
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
          ['C'],
        ],
      },
      {
        franchiseId: 'celtics',
        eraId: '1990s',
        positions: [
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['SF'],
          ['SF'],
          ['PF', 'C'],
          ['C'],
          ['C'],
          ['PG'],
          ['SF'],
          ['PF', 'C'],
        ],
      },
    ]);
    let state = stateWithNinePicks(catalog, seedFromString('infeasible-pick'));
    const center = catalog.candidates.find(
      (c) =>
        c.franchiseId === 'lakers' &&
        c.positions.playable.length === 1 &&
        c.positions.playable[0] === 'C',
    );
    if (!center) throw new Error('no center candidate');
    state = seasonDraftStateSchema.parse({
      ...state,
      currentReveal: {
        participantId: 'p1',
        round: 10,
        pickOrdinal: 10,
        attempts: [{ franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true }],
      },
      rolls: [
        ...state.rolls,
        { franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true },
      ],
    });
    const result = applySeasonDraftCommand(
      state,
      catalog,
      cmd('c-pick-center', 10, {
        kind: 'select-draft-player',
        participantId: 'p1',
        playerVersionId: center.playerVersionId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('UNCOMPLETABLE_ROSTER');
  });

  it('owns versions (not players) so same-person versions coexist', () => {
    // The same playerId can peak in two franchise/era pools; both versions
    // must be claimable as distinct ownership keys.
    const catalog = customCatalog([
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        positions: [
          ['PG'],
          ['SG'],
          ['SF'],
          ['PF'],
          ['C'],
          ['PG'],
          ['SG'],
          ['SF'],
          ['PF'],
          ['C'],
          ['SF'],
          ['PF'],
        ],
      },
      {
        franchiseId: 'lakers',
        eraId: '2000s',
        positions: [
          ['PG'],
          ['SG'],
          ['SF'],
          ['PF'],
          ['C'],
          ['PG'],
          ['SG'],
          ['SF'],
          ['PF'],
          ['C'],
          ['SF'],
          ['PF'],
        ],
      },
    ]);
    const lakers90 = catalog.candidates.find(
      (c) => c.franchiseId === 'lakers' && c.eraId === '1990s',
    );
    const lakers00 = catalog.candidates.find(
      (c) => c.franchiseId === 'lakers' && c.eraId === '2000s',
    );
    if (!lakers90 || !lakers00) throw new Error('candidates missing');
    // Rewrite the 2000s candidate to the SAME playerId as the 1990s one and
    // keep the pool membership in sync with the new version id.
    lakers00.playerId = lakers90.playerId;
    lakers00.playerVersionId = `pv-${seasonDigestHex(`same-${lakers90.playerId}`)}`;
    const pool00 = catalog.pools.find((p) => p.franchiseId === 'lakers' && p.eraId === '2000s');
    if (!pool00) throw new Error('pool missing');
    pool00.playerVersionIds[0] = lakers00.playerVersionId;
    const state = requireState(
      createSolo(catalog, LEAGUE, seedFromString('same-person')).state,
      'create',
    );
    // Force the reveal for round 1 to the 1990s pool by using a hand-built
    // reveal and pick (the draft remains deterministic and legal).
    const withReveal = seasonDraftStateSchema.parse({
      ...state,
      currentReveal: {
        participantId: 'p1',
        round: 1,
        pickOrdinal: 1,
        attempts: [{ franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true }],
      },
      rolls: [
        ...state.rolls,
        { franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true },
      ],
    });
    const first = applySeasonDraftCommand(
      withReveal,
      catalog,
      cmd('c-pick-90', 1, {
        kind: 'select-draft-player',
        participantId: 'p1',
        playerVersionId: lakers90.playerVersionId,
      }),
      fakeDeps(),
    );
    expectAccepted(first.record);
    const afterFirst = requireState(first.state, 'pick');
    const withReveal2 = seasonDraftStateSchema.parse({
      ...afterFirst,
      currentReveal: {
        participantId: 'p1',
        round: 2,
        pickOrdinal: 2,
        attempts: [{ franchiseId: 'lakers', eraId: '2000s', attemptIndex: 0, usable: true }],
      },
      rolls: [
        ...afterFirst.rolls,
        { franchiseId: 'lakers', eraId: '2000s', attemptIndex: 0, usable: true },
      ],
    });
    const second = applySeasonDraftCommand(
      withReveal2,
      catalog,
      cmd('c-pick-00', 2, {
        kind: 'select-draft-player',
        participantId: 'p1',
        playerVersionId: lakers00.playerVersionId,
      }),
      fakeDeps(),
    );
    expectAccepted(second.record);
    const ownedIds = second.state?.picks.map((p) => p.playerVersionId);
    expect(ownedIds).toContain(lakers90.playerVersionId);
    expect(ownedIds).toContain(lakers00.playerVersionId);
    expect(ownedIds).toHaveLength(2);
  });
});

describe('season draft finalize and generation', () => {
  it('rejects finalize before the roster is complete', () => {
    const state = requireState(createSolo().state, 'create');
    const result = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-finalize', 1, { kind: 'finalize-human-rosters' }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('UNCOMPLETABLE_ROSTER');
  });

  it('rejects finalize when the roster misses the completion target', () => {
    // Hand-built ten guard-only picks: the pick-time feasibility search would
    // block this through the command path, so finalize's own completion-target
    // check is exercised directly as defense-in-depth.
    const catalog = customCatalog([
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        positions: [
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
        ],
      },
      {
        franchiseId: 'celtics',
        eraId: '1990s',
        positions: [
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
          ['PG'],
        ],
      },
    ]);
    const created = createSolo(catalog, LEAGUE, seedFromString('all-guards'));
    expectAccepted(created.record);
    const state = requireState(created.state, 'create');
    const guardPicks = catalog.candidates.slice(0, 10).map((c, i) => ({
      participantId: 'p1',
      round: i + 1,
      pickOrdinal: i + 1,
      playerVersionId: c.playerVersionId,
      franchiseId: c.franchiseId,
      eraId: c.eraId,
      rollAttempts: 1,
    }));
    const allGuards = seasonDraftStateSchema.parse({
      ...state,
      picks: guardPicks,
      revision: 11,
      round: 10,
      currentReveal: null,
      commandLog: state.commandLog,
    });
    const result = applySeasonDraftCommand(
      allGuards,
      catalog,
      cmd('c-finalize', 11, { kind: 'finalize-human-rosters' }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('UNCOMPLETABLE_ROSTER');
  });

  it('finalizes and generates the AI league with the injected generator', () => {
    const { state, generation } = playFullDraft(
      FULL_CATALOG,
      LEAGUE,
      seedFromString('happy-path'),
      fakeDeps(),
      ['p1'],
      'hp',
    );
    expect(state.status).toBe('complete');
    expect(seasonLeagueGenerationResultSchema.parse(generation)).toBeTruthy();
    const logKinds = state.commandLog.map((r) => r.command.payload.kind);
    expect(logKinds).toContain('generate-ai-league');
    expect(state.picks.filter((p) => p.participantId === 'p1')).toHaveLength(10);
  });

  it('rejects generate before finalize and records GENERATION_EXHAUSTED failures', () => {
    const state = requireState(createSolo().state, 'create');
    const early = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-gen', 1, { kind: 'generate-ai-league' }),
      fakeDeps(),
    );
    expect(expectRejected(early.record).errorCode).toBe('ILLEGAL_PICK');

    const exploding: SeasonAiGenerationDeps = {
      generate: () => {
        throw new SeasonAiGenerationError({
          seed: SEED,
          aiVersion: 'season-ai-v1',
          rosterGenerationVersion: 'roster-generation-v1',
          teamsGenerated: 20,
          teamsRepaired: 0,
          backtracks: 0,
          nodesVisited: 100000,
          nodeBudget: 100000,
          failedTeams: ['lakers'],
          unmetConstraints: ['role perimeter-defense on 3 teams'],
        });
      },
    };
    // Reach finalized with the fake generator, then generate with the
    // exploding one to prove the rejection path.
    const finalized = playToFinalized(
      FULL_CATALOG,
      LEAGUE,
      seedFromString('exhausted'),
      fakeDeps(),
      ['p1'],
      'ex',
    );
    const result = applySeasonDraftCommand(
      finalized,
      FULL_CATALOG,
      cmd('c-gen-2', finalized.revision, { kind: 'generate-ai-league' }),
      exploding,
    );
    expect(expectRejected(result.record).errorCode).toBe('GENERATION_EXHAUSTED');
    expect(result.state?.status).toBe('finalized');
  });
});

describe('season draft idempotency, revisions, and replay', () => {
  it('is idempotent for duplicate command ids', () => {
    const state = requireState(createSolo().state, 'create');
    const revealed = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-reveal-dup', 1, { kind: 'reveal-draft-roll', participantId: 'p1' }),
      fakeDeps(),
    );
    const next = requireState(revealed.state, 'reveal');
    const before = seasonDraftStateCanonical(next);
    const again = applySeasonDraftCommand(
      next,
      CATALOG,
      cmd('c-reveal-dup', 1, { kind: 'reveal-draft-roll', participantId: 'p1' }),
      fakeDeps(),
    );
    expect(again.record).toEqual(revealed.record);
    expect(seasonDraftStateCanonical(requireState(again.state, 'replay'))).toBe(before);
  });

  it('rejects stale revisions and logs the rejection', () => {
    const state = requireState(createSolo().state, 'create');
    const before = seasonDraftStateCanonical(state);
    const stale = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-reveal-stale', 99, { kind: 'reveal-draft-roll', participantId: 'p1' }),
      fakeDeps(),
    );
    expect(expectRejected(stale.record).errorCode).toBe('STALE_REVISION');
    expect(seasonDraftStateCanonical(requireState(stale.state, 'stale'))).not.toBe(before);
    expect(stale.state?.commandLog.at(-1)?.status).toBe('rejected');
    expect(stale.state?.revision).toBe(state.revision);
  });

  it('replays byte-for-byte continuously and from the command log', () => {
    const deps = fakeDeps();
    const continuous = playFullDraft(
      FULL_CATALOG,
      LEAGUE,
      seedFromString('replay'),
      deps,
      ['p1'],
      'rp',
    );
    const commands = continuous.state.commandLog
      .filter((r) => r.status === 'accepted')
      .map((r) => r.command);
    const replayed = commands.reduce<SeasonDraftState | null>((acc, command) => {
      const result = applySeasonDraftCommand(acc, FULL_CATALOG, command, deps);
      return result.state;
    }, null);
    expect(canonicalFacts(requireState(replayed, 'replay'))).toBe(canonicalFacts(continuous.state));
    expect(replayed?.revision).toBe(continuous.state.revision);
    // The command logs are byte-identical too: replaying accepted commands
    // reproduces every record.
    expect(JSON.stringify(replayed?.commandLog)).toBe(JSON.stringify(continuous.state.commandLog));
  });

  it('survives chunked property replay with interleaved stale commands', () => {
    const deps = fakeDeps();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (chunk) => {
        const continuous = playFullDraft(
          FULL_CATALOG,
          LEAGUE,
          seedFromString('chunked'),
          deps,
          ['p1'],
          'ck',
        );
        const commands = continuous.state.commandLog
          .filter((r) => r.status === 'accepted')
          .map((r) => r.command);
        let walk: SeasonDraftState | null = null;
        for (let start = 0; start < commands.length; start += chunk) {
          const slice = commands.slice(start, start + chunk);
          for (const command of slice) {
            const stale = applySeasonDraftCommand(
              walk,
              FULL_CATALOG,
              { ...command, commandId: `${command.commandId}-stale`, expectedRevision: 9999 },
              deps,
            );
            if (walk !== null) {
              expect(expectRejected(stale.record).errorCode).toBe('STALE_REVISION');
            }
            const result = applySeasonDraftCommand(walk, FULL_CATALOG, command, deps);
            walk = result.state;
          }
        }
        expect(canonicalFacts(requireState(walk, 'walk'))).toBe(canonicalFacts(continuous.state));
      }),
      { numRuns: 6 },
    );
  });
  it('completes a two-human draft with snake reversal across ten rounds', () => {
    const { state } = playFullDraft(
      FULL_CATALOG,
      LEAGUE,
      seedFromString('snake'),
      fakeDeps(),
      ['p1', 'p2'],
      'sn',
    );
    expect(state.status).toBe('complete');
    expect(state.picks.filter((p) => p.participantId === 'p1')).toHaveLength(10);
    expect(state.picks.filter((p) => p.participantId === 'p2')).toHaveLength(10);
    const p1Rounds = state.picks
      .filter((p) => p.participantId === 'p1')
      .map((p) => p.round)
      .sort((a, b) => a - b);
    expect(p1Rounds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const firstPicker = state.picks.find((p) => p.round === 1)?.participantId;
    const round2First = state.picks.find((p) => p.round === 2)?.participantId;
    expect(round2First).not.toBe(firstPicker);
    // Unique ownership across the whole league.
    const versions = state.picks.map((p) => p.playerVersionId);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
