import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  SEASON_DRAFT_OFFER_SIZE,
  SEASON_DRAFT_SAFE_MINIMUM,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_VERSION,
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  positionSchema,
  seasonDraftStateSchema,
  seasonLeagueGenerationResultSchema,
  seasonNamespaceSeed,
  seedSchema,
  seasonDigestHex,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonDraftCommand,
  type SeasonDraftCommandRecord,
  type SeasonDraftState,
  type SeasonDraftAcceptedRecord,
  type SeasonDraftRejectedRecord,
  type SeasonDraftOffer,
  type SeasonAiPool,
  type SeasonGenerationDiagnostics,
  type SeasonLeague,
  type SeasonLeagueGenerationResult,
  type Seed,
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
} from './draft.ts';
import { seasonGenerationDigest } from './digest.ts';
import { SeasonAiGenerationError } from './ai.ts';
const CATALOG = buildSeasonDraftCatalog();
const FULL_CATALOG = buildSeasonDraftCatalog({
  franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
  eras: ['1980s', '1990s', '2000s', '2010s'],
  playersPerPool: 40,
});
const LEAGUE = buildSeasonLeague();
const SEED = seedSchema.parse(seedFromString('draft-test-seed'));
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
function canonicalFacts(state: SeasonDraftState): string {
  return seasonDraftStateCanonical({ ...state, commandLog: [] });
}
function fakeDeps(): SeasonAiGenerationDeps {
  return { generate: (input) => buildFakeGeneration(input) };
}
type FakeGenerationInput = Omit<SeasonAiGenerationInput, 'targets'>;
function buildFakeGeneration(input: FakeGenerationInput): SeasonLeagueGenerationResult {
  const owned = new Set<string>();
  for (const roster of input.humanRosters) {
    for (const versionId of roster.playerVersionIds) owned.add(versionId);
  }
  const pools = new Map<string, string[]>();
  const rosters = input.league.teams.map((team) => {
    const human = input.humanRosters.find((r) => r.franchiseId === team.franchiseId);
    const players =
      human !== undefined
        ? human.playerVersionIds
        : (() => {
            const available = input.catalog.candidates.filter((c) => !owned.has(c.playerVersionId));
            const picks = available.slice(0, 10).map((c) => c.playerVersionId);
            const poolMembers = [
              ...picks,
              ...available.slice(10, 20).map((c) => c.playerVersionId),
            ];
            for (const memberId of poolMembers) owned.add(memberId);
            pools.set(team.franchiseId, poolMembers);
            return picks;
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
  const aiPools = input.league.teams
    .filter((team) => pools.has(team.franchiseId))
    .map((team) => {
      const roster = rosters.find((r) => r.franchiseId === team.franchiseId);
      const assignment = aiAssignments.find((a) => a.franchiseId === team.franchiseId);
      const playerVersionIds = [...(pools.get(team.franchiseId) ?? [])].sort();
      const selections = [...(roster?.players.map((p) => p.playerVersionId) ?? [])].sort();
      return {
        franchiseId: team.franchiseId,
        band: assignment?.band ?? ('average' as const),
        identity: assignment?.identity ?? ('continuity' as const),
        playerVersionIds,
        anchors: [] as SeasonAiPool['anchors'],
        selections,
        allocationSeedPaths: selections.map((versionId) => [
          'ai-rosters',
          'pool-fill',
          '0',
          versionId,
        ]),
        repairCount: 0,
      };
    });
  const diagnostics: SeasonGenerationDiagnostics = {
    seed: input.seed,
    aiVersion: 'season-ai-v2',
    rosterGenerationVersion: 'roster-generation-v2',
    teamsGenerated: 29,
    teamsRepaired: 0,
    backtracks: 0,
    nodesVisited: 29,
    nodeBudget: 80000,
    failedTeams: [],
    unmetConstraints: [],
  };
  const digest = seasonGenerationDigest({
    seed: input.seed,
    aiVersion: 'season-ai-v2',
    rosterGenerationVersion: 'roster-generation-v2',
    rotationVersion: SEASON_ROTATION_VERSION,
    rosters,
    ownership,
    rotations,
    aiAssignments,
    targetsVersion: SEASON_ROSTER_TARGETS_VERSION,
    aiPools,
    diagnostics,
  });
  return seasonLeagueGenerationResultSchema.parse({
    schemaVersion: 2,
    seed: input.seed,
    aiVersion: 'season-ai-v2',
    rosterGenerationVersion: 'roster-generation-v2',
    rotationVersion: SEASON_ROTATION_VERSION,
    rosters,
    ownership,
    rotations,
    aiAssignments,
    evaluations,
    aiPools,
    diagnostics,
    digest,
  });
}
function createSolo(
  catalog: SeasonDraftCatalog = CATALOG,
  league: SeasonLeague = LEAGUE,
  rootSeed: Seed | string = SEED,
) {
  return applySeasonDraftCommand(
    null,
    catalog,
    cmd('c-create', 0, {
      kind: 'create-season-draft',
      runId: 'run-1',
      rootSeed: seedSchema.parse(rootSeed),
      league,
      humanParticipantIds: ['p1'],
      catalogVersion: 'season-draft-v2',
    }),
    fakeDeps(),
  );
}
function createDuo(
  catalog: SeasonDraftCatalog = FULL_CATALOG,
  league: SeasonLeague = LEAGUE,
  rootSeed: Seed | string = SEED,
) {
  return applySeasonDraftCommand(
    null,
    catalog,
    cmd('c-create', 0, {
      kind: 'create-season-draft',
      runId: 'run-1',
      rootSeed: seedSchema.parse(rootSeed),
      league,
      humanParticipantIds: ['p1', 'p2'],
      catalogVersion: 'season-draft-v2',
    }),
    fakeDeps(),
  );
}
function pickBestSelectable(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  commandId: string,
): SeasonDraftState {
  const offer = state.currentOffer;
  if (offer === null) throw new Error('no offer drawn for the pick');
  const candidates = catalog.candidates
    .filter((c) => offer.cards.some((card) => card.playerVersionId === c.playerVersionId))
    .filter(
      (c) => offer.cards.find((card) => card.playerVersionId === c.playerVersionId)?.selectable,
    )
    .sort(
      (a, b) =>
        b.summaryRatings.overallRating - a.summaryRatings.overallRating ||
        a.playerVersionId.localeCompare(b.playerVersionId),
    );
  if (candidates.length === 0) throw new Error('no selectable card in the offer');
  const first = candidates[0];
  if (first === undefined) throw new Error('no selectable card in the offer');
  const result = applySeasonDraftCommand(
    state,
    catalog,
    cmd(commandId, state.revision, {
      kind: 'select-draft-player',
      participantId: offer.participantId,
      playerVersionId: first.playerVersionId,
    }),
    fakeDeps(),
  );
  if (result.record.status !== 'accepted' || result.state === null) {
    throw new Error(
      `pickBestSelectable rejected: ${result.record.status === 'rejected' ? result.record.message : 'no state'}`,
    );
  }
  return result.state;
}
function drawAndPick(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  commandIdPrefix: string,
  sequence: number,
): {
  state: SeasonDraftState;
  offer: SeasonDraftOffer;
} {
  const pid = state.currentTurnParticipantId;
  if (pid === null) throw new Error('no active turn');
  const drawn = applySeasonDraftCommand(
    state,
    catalog,
    cmd(`${commandIdPrefix}-draw-${String(sequence)}`, state.revision, {
      kind: 'draw-season-offer',
      participantId: pid,
    }),
    fakeDeps(),
  );
  expectAccepted(drawn.record);
  const drawnState = requireState(drawn.state, 'draw');
  const offer = drawnState.currentOffer;
  if (offer === null) throw new Error('no offer after draw');
  return {
    state: pickBestSelectable(drawnState, catalog, `${commandIdPrefix}-pick-${String(sequence)}`),
    offer,
  };
}
function playToFinalized(
  catalog: SeasonDraftCatalog,
  league: SeasonLeague,
  rootSeed: Seed | string,
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
      rootSeed: seedSchema.parse(rootSeed),
      league,
      humanParticipantIds: ids,
      catalogVersion: 'season-draft-v2',
    }),
    deps,
  );
  expectAccepted(created.record);
  let state = requireState(created.state, 'create');
  let sequence = 0;
  while (state.status === 'drafting' && state.currentTurnParticipantId !== null) {
    const drawn = drawAndPick(state, catalog, commandIdPrefix, sequence);
    state = drawn.state;
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
  rootSeed: Seed | string,
  deps: SeasonAiGenerationDeps,
  ids: string[],
  commandIdPrefix: string,
): {
  state: SeasonDraftState;
  generation: SeasonLeagueGenerationResult;
} {
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
    generation: seasonLeagueGenerationResultSchema.parse(generated.generation),
  };
}
function customCatalog(
  entries: Array<{
    franchiseId: string;
    eraId: string;
    positions: string[][];
  }>,
): SeasonDraftCatalog {
  const candidates: SeasonDraftCandidate[] = [];
  const pools: SeasonDraftCatalog['pools'] = [];
  for (const entry of entries) {
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
      candidate.playerId = playerIdSchema.parse(playerId);
      candidate.playerVersionId = `pv-${seasonDigestHex(`cand-${playerId}`)}`;
      candidate.positions.playable = playable.map((p) => positionSchema.parse(p));
      const primary = playable[0];
      if (primary === undefined) throw new Error('customCatalog missing positions');
      candidate.positions.primary = positionSchema.parse(primary);
      candidate.positions.secondary = playable.slice(1).map((p) => positionSchema.parse(p));
      candidates.push(candidate);
      members.push(candidate.playerVersionId);
    }
    pools.push({
      franchiseId: franchiseIdSchema.parse(entry.franchiseId),
      eraId: eraIdSchema.parse(entry.eraId),
      playerVersionIds: members,
    });
  }
  return { ...buildSeasonDraftCatalog(), pools, candidates };
}
function stateWithNinePicks(catalog: SeasonDraftCatalog, rootSeed: Seed | string): SeasonDraftState {
  const created = createSolo(catalog, LEAGUE, seedSchema.parse(rootSeed));
  expectAccepted(created.record);
  const state = requireState(created.state, 'create');
  const guards = catalog.candidates.filter((c) => c.positions.playable.includes('PG'));
  const forwards = catalog.candidates.filter((c) => c.positions.playable.includes('SF'));
  const centers = catalog.candidates.filter((c) => c.positions.playable.includes('C'));
  const picks = [...guards.slice(0, 4), ...forwards.slice(0, 3), ...centers.slice(0, 2)];
  if (picks.length !== 9) throw new Error('expected nine hand picks');
  const handPicks = picks.map((c, i) => ({
    participantId: 'p1',
    round: i + 1,
    pickOrdinal: i + 1,
    playerVersionId: c.playerVersionId,
    franchiseId: c.franchiseId,
    eraId: c.eraId,
    seedPath: ['draft', 'offer', 'p1', String(i + 1), String(i + 1)],
  }));
  return seasonDraftStateSchema.parse({
    ...state,
    picks: handPicks,
    revision: 10,
    round: 10,
    currentOffer: null,
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
    expect(state.schemaVersion).toBe(2);
    expect(state.draftVersion).toBe('season-draft-v2');
    expect(state.catalogVersion).toBe('season-draft-v2');
    expect(state.currentOffer).toBeNull();
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
        catalogVersion: 'season-draft-v2',
      }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('STALE_REVISION');
  });
  it('rejects non-create commands before any draft exists', () => {
    const result = applySeasonDraftCommand(
      null,
      CATALOG,
      cmd('c-draw', 0, { kind: 'draw-season-offer', participantId: 'p1' }),
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
        catalogVersion: 'season-draft-v2',
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
        catalogVersion: 'season-draft-v2',
      }),
      fakeDeps(),
    );
    expect(expectRejected(result2.record).errorCode).toBe('INVALID_CATALOG');
  });
  it('rejects creation when the catalog has fewer than eight candidates', () => {
    const small = buildSeasonDraftCatalog({
      franchiseIds: ['lakers'],
      eras: ['1990s'],
      playersPerPool: 6,
    });
    expect(small.candidates.length).toBeLessThan(8);
    const result = applySeasonDraftCommand(
      null,
      small,
      cmd('c-create', 0, {
        kind: 'create-season-draft',
        runId: 'run-1',
        rootSeed: SEED,
        league: LEAGUE,
        humanParticipantIds: ['p1', 'p2'],
        catalogVersion: 'season-draft-v2',
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
        catalogVersion: 'season-draft-v2',
      }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('INVALID_CATALOG');
  });
});
function handOffer(
  catalog: SeasonDraftCatalog,
  participantId: string,
  round: number,
  pickOrdinal: number,
  cards: Array<{
    playerVersionId: string;
    selectable: boolean;
    coverageReason: string | null;
  }>,
): SeasonDraftOffer {
  const used = new Set(cards.map((c) => c.playerVersionId));
  const fillers = catalog.candidates
    .filter((c) => !used.has(c.playerVersionId))
    .map((c) => ({
      playerVersionId: c.playerVersionId,
      selectable: true,
      coverageReason: null,
    }));
  const padded = [...cards];
  for (const filler of fillers) {
    if (padded.length >= SEASON_DRAFT_OFFER_SIZE) break;
    padded.push(filler);
  }
  if (padded.length !== SEASON_DRAFT_OFFER_SIZE) {
    throw new Error('catalog too small to pad an eight-card offer');
  }
  return {
    participantId,
    round,
    pickOrdinal,
    seedPath: ['draft', 'offer', participantId, String(round), String(pickOrdinal)],
    cards: padded,
  };
}
describe('season draft offers', () => {
  it('draws exactly eight distinct cards with at least three selectable', () => {
    const state = requireState(createSolo().state, 'create');
    const drawn = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-draw-1', 1, { kind: 'draw-season-offer', participantId: 'p1' }),
      fakeDeps(),
    );
    expectAccepted(drawn.record);
    const next = requireState(drawn.state, 'draw');
    const offer = next.currentOffer;
    expect(offer).not.toBeNull();
    expect(offer?.cards).toHaveLength(SEASON_DRAFT_OFFER_SIZE);
    expect(new Set(offer?.cards.map((c) => c.playerVersionId)).size).toBe(SEASON_DRAFT_OFFER_SIZE);
    expect(offer?.cards.filter((c) => c.selectable).length).toBeGreaterThanOrEqual(
      SEASON_DRAFT_SAFE_MINIMUM,
    );
    expect(offer?.participantId).toBe('p1');
    expect(offer?.round).toBe(1);
    expect(offer?.pickOrdinal).toBe(1);
    expect(offer?.seedPath).toEqual([
      'draft',
      'offer',
      'p1',
      '1',
      '1',
      'safe-order',
      'sample-order',
    ]);
    expect(next.offers).toHaveLength(1);
    expect(next.offers[0]).toEqual(offer);
  });
  it('shows every selectable card with a null reason and disabled cards with a stable reason', () => {
    const state = requireState(createSolo().state, 'create');
    const drawn = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-draw-1', 1, { kind: 'draw-season-offer', participantId: 'p1' }),
      fakeDeps(),
    );
    const offer = requireState(drawn.state, 'draw').currentOffer;
    expect(offer).not.toBeNull();
    for (const card of offer?.cards ?? []) {
      if (card.selectable) {
        expect(card.coverageReason).toBeNull();
      } else {
        expect(card.coverageReason).not.toBeNull();
        expect(card.coverageReason?.length).toBeGreaterThan(0);
      }
    }
  });
  it('rejects draw for the wrong participant and re-drawing is an accepted no-op', () => {
    const state = requireState(createDuo().state, 'create');
    const wrongTurn = applySeasonDraftCommand(
      state,
      FULL_CATALOG,
      cmd('c-draw-wrong', 1, { kind: 'draw-season-offer', participantId: 'p2' }),
      fakeDeps(),
    );
    expect(expectRejected(wrongTurn.record).errorCode).toBe('WRONG_TURN');
    const drawn = applySeasonDraftCommand(
      state,
      FULL_CATALOG,
      cmd('c-draw-1', 1, {
        kind: 'draw-season-offer',
        participantId: state.firstPickParticipantId,
      }),
      fakeDeps(),
    );
    expectAccepted(drawn.record);
    const next = requireState(drawn.state, 'draw');
    const again = applySeasonDraftCommand(
      next,
      FULL_CATALOG,
      cmd('c-draw-1b', next.revision, {
        kind: 'draw-season-offer',
        participantId: state.firstPickParticipantId,
      }),
      fakeDeps(),
    );
    expectAccepted(again.record);
    expect(again.state?.currentOffer).toEqual(next.currentOffer);
    expect(again.state?.offers).toHaveLength(1);
  });
  it('reproduces offers byte-for-byte from identical seeds and commands', () => {
    const first = playFullDraft(
      FULL_CATALOG,
      LEAGUE,
      seedFromString('offer-repro'),
      fakeDeps(),
      ['p1'],
      'or',
    );
    const second = playFullDraft(
      FULL_CATALOG,
      LEAGUE,
      seedFromString('offer-repro'),
      fakeDeps(),
      ['p1'],
      'or2',
    );
    expect(first.state.offers).toEqual(second.state.offers);
    expect(first.state.picks).toEqual(second.state.picks);
    expect(canonicalFacts(first.state)).toBe(canonicalFacts(second.state));
  });
  it('rejects a draw with NO_FEASIBLE_GLOBAL_OFFER when fewer than three safe candidates remain', () => {
    const catalog = customCatalog([
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        positions: Array.from({ length: 12 }, () => ['C']),
      },
      {
        franchiseId: 'celtics',
        eraId: '1990s',
        positions: Array.from({ length: 12 }, () => ['PG']),
      },
      {
        franchiseId: 'bulls',
        eraId: '1990s',
        positions: Array.from({ length: 12 }, () => ['SF']),
      },
    ]);
    const state = stateWithNinePicks(catalog, seedFromString('no-safe-offer'));
    const result = applySeasonDraftCommand(
      state,
      catalog,
      cmd('c-draw-10', 10, { kind: 'draw-season-offer', participantId: 'p1' }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('NO_FEASIBLE_GLOBAL_OFFER');
    expect(result.state?.currentOffer).toBeNull();
    expect(result.state?.offers).toHaveLength(0);
    expect(result.state?.revision).toBe(state.revision);
  });
  it('rejects a draw when fewer than eight unowned candidates remain', () => {
    const tiny = buildSeasonDraftCatalog({
      franchiseIds: ['lakers'],
      eras: ['1990s'],
      playersPerPool: 8,
    });
    expect(tiny.candidates.length).toBe(SEASON_DRAFT_OFFER_SIZE);
    const state = requireState(
      createSolo(tiny, LEAGUE, seedFromString('few-left')).state,
      'create',
    );
    const ownedCandidate = tiny.candidates[0];
    if (!ownedCandidate) throw new Error('no candidate');
    const onePick = seasonDraftStateSchema.parse({
      ...state,
      picks: [
        {
          participantId: 'p1',
          round: 1,
          pickOrdinal: 1,
          playerVersionId: ownedCandidate.playerVersionId,
          franchiseId: ownedCandidate.franchiseId,
          eraId: ownedCandidate.eraId,
          seedPath: ['draft', 'offer', 'p1', '1', '1'],
        },
      ],
      revision: 2,
      round: 1,
      currentOffer: null,
      commandLog: state.commandLog,
    });
    const result = applySeasonDraftCommand(
      onePick,
      tiny,
      cmd('c-draw', 2, { kind: 'draw-season-offer', participantId: 'p1' }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('NO_FEASIBLE_GLOBAL_OFFER');
    expect(expectRejected(result.record).message).toContain('unowned candidates remain');
  });
});
describe('season draft picks', () => {
  it('picks a legal player, advances the snake, and clears the offer', () => {
    const state = requireState(createDuo().state, 'create');
    const first = state.firstPickParticipantId;
    const other = first === 'p1' ? 'p2' : 'p1';
    const drawn = drawAndPick(state, FULL_CATALOG, 'c', 1);
    expect(drawn.state.picks).toHaveLength(1);
    expect(drawn.state.currentOffer).toBeNull();
    expect(drawn.state.currentTurnParticipantId).toBe(other);
    expect(drawn.state.round).toBe(1);
    expect(drawn.state.picks[0]?.seedPath).toEqual(drawn.offer.seedPath);
    expect(drawn.state.picks[0]?.round).toBe(1);
    expect(drawn.state.picks[0]?.pickOrdinal).toBe(1);
    expect(drawn.state.picks[0]?.participantId).toBe(first);
  });
  it('rejects picks for the wrong turn, no offer, out-of-offer, owned, and disabled cards', () => {
    const state = requireState(createDuo().state, 'create');
    const first = state.firstPickParticipantId;
    const other = first === 'p1' ? 'p2' : 'p1';
    const drawn = applySeasonDraftCommand(
      state,
      FULL_CATALOG,
      cmd('c-draw-1', 1, { kind: 'draw-season-offer', participantId: first }),
      fakeDeps(),
    );
    const next = requireState(drawn.state, 'draw');
    const offer = next.currentOffer;
    expect(offer).not.toBeNull();
    const inOffer = offer?.cards[0];
    if (!inOffer) throw new Error('no offer cards');
    const outOfOffer = FULL_CATALOG.candidates.find(
      (c) => !offer.cards.some((card) => card.playerVersionId === c.playerVersionId),
    );
    if (!outOfOffer) throw new Error('no out-of-offer candidate');
    const wrongTurn = applySeasonDraftCommand(
      next,
      FULL_CATALOG,
      cmd('c-pick-wrong', next.revision, {
        kind: 'select-draft-player',
        participantId: other,
        playerVersionId: inOffer.playerVersionId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(wrongTurn.record).errorCode).toBe('WRONG_TURN');
    const noOffer = applySeasonDraftCommand(
      state,
      FULL_CATALOG,
      cmd('c-pick-nooffer', 1, {
        kind: 'select-draft-player',
        participantId: first,
        playerVersionId: inOffer.playerVersionId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(noOffer.record).errorCode).toBe('NO_OFFER_DRAWN');
    const outside = applySeasonDraftCommand(
      next,
      FULL_CATALOG,
      cmd('c-pick-out', next.revision, {
        kind: 'select-draft-player',
        participantId: first,
        playerVersionId: outOfOffer.playerVersionId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(outside.record).errorCode).toBe('UNAVAILABLE_POOL');
    const ownedTurn = seasonDraftStateSchema.parse({
      ...next,
      currentTurnParticipantId: first,
      round: 2,
      picks: [
        ...next.picks,
        {
          participantId: first,
          round: 1,
          pickOrdinal: 1,
          playerVersionId: inOffer.playerVersionId,
          franchiseId: 'lakers',
          eraId: '1990s',
          seedPath: ['draft', 'offer', first, '1', '1'],
        },
      ],
    });
    const ownedAgain = applySeasonDraftCommand(
      ownedTurn,
      FULL_CATALOG,
      cmd('c-pick-owned', ownedTurn.revision, {
        kind: 'select-draft-player',
        participantId: first,
        playerVersionId: inOffer.playerVersionId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(ownedAgain.record).errorCode).toBe('OWNED_VERSION');
    const withDisabled = seasonDraftStateSchema.parse({
      ...next,
      currentOffer: {
        ...offer,
        cards: offer.cards.map((card, index) =>
          index === 0
            ? {
                ...card,
                selectable: false,
                coverageReason:
                  'Selecting this version would leave the 4G/4F/3C completion targets unreachable with the remaining picks',
              }
            : card,
        ),
      },
    });
    const disabled = applySeasonDraftCommand(
      withDisabled,
      FULL_CATALOG,
      cmd('c-pick-disabled', withDisabled.revision, {
        kind: 'select-draft-player',
        participantId: first,
        playerVersionId: inOffer.playerVersionId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(disabled.record).errorCode).toBe('UNCOMPLETABLE_ROSTER');
    expect(expectRejected(disabled.record).message).toContain('completion targets unreachable');
  });
  it('rejects a pick when the roster is already full', () => {
    const state = requireState(createSolo(FULL_CATALOG, LEAGUE, SEED).state, 'create');
    const drawn = drawAndPick(state, FULL_CATALOG, 'c', 1);
    let walk = drawn.state;
    for (let round = 2; round <= 9; round += 1) {
      walk = drawAndPick(walk, FULL_CATALOG, 'c', round).state;
    }
    expect(walk.picks.filter((p) => p.participantId === 'p1')).toHaveLength(9);
    const extra = FULL_CATALOG.candidates.find(
      (c) => !walk.picks.some((p) => p.playerVersionId === c.playerVersionId),
    );
    if (!extra) throw new Error('no extra candidate');
    const offerCard = FULL_CATALOG.candidates.find(
      (c) =>
        c.playerVersionId !== extra.playerVersionId &&
        !walk.picks.some((p) => p.playerVersionId === c.playerVersionId),
    );
    if (!offerCard) throw new Error('no offer card candidate');
    const fullRoster = seasonDraftStateSchema.parse({
      ...walk,
      picks: [
        ...walk.picks,
        {
          participantId: 'p1',
          round: 10,
          pickOrdinal: 10,
          playerVersionId: extra.playerVersionId,
          franchiseId: extra.franchiseId,
          eraId: extra.eraId,
          seedPath: ['draft', 'offer', 'p1', '10', '10'],
        },
      ],
      currentTurnParticipantId: 'p1',
      currentOffer: handOffer(FULL_CATALOG, 'p1', 10, 10, [
        { playerVersionId: offerCard.playerVersionId, selectable: true, coverageReason: null },
      ]),
      revision: walk.revision + 1,
    });
    const result = applySeasonDraftCommand(
      fullRoster,
      FULL_CATALOG,
      cmd('c-pick-full', fullRoster.revision, {
        kind: 'select-draft-player',
        participantId: 'p1',
        playerVersionId: offerCard.playerVersionId,
      }),
      fakeDeps(),
    );
    expect(expectRejected(result.record).errorCode).toBe('ILLEGAL_PICK');
  });
  it('owns versions (not players) so same-person versions coexist', () => {
    const catalog = customCatalog([
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        positions: Array.from({ length: 12 }, (_, i) => (i < 5 ? ['PG'] : i < 10 ? ['SF'] : ['C'])),
      },
      {
        franchiseId: 'lakers',
        eraId: '2000s',
        positions: Array.from({ length: 12 }, (_, i) => (i < 5 ? ['PG'] : i < 10 ? ['SF'] : ['C'])),
      },
    ]);
    const lakers90 = catalog.candidates.find(
      (c) => c.franchiseId === 'lakers' && c.eraId === '1990s',
    );
    const lakers00 = catalog.candidates.find(
      (c) => c.franchiseId === 'lakers' && c.eraId === '2000s',
    );
    if (!lakers90 || !lakers00) throw new Error('candidates missing');
    lakers00.playerId = lakers90.playerId;
    lakers00.playerVersionId = `pv-${seasonDigestHex(`same-${lakers90.playerId}`)}`;
    const pool00 = catalog.pools.find((p) => p.franchiseId === 'lakers' && p.eraId === '2000s');
    if (!pool00) throw new Error('pool missing');
    pool00.playerVersionIds[0] = lakers00.playerVersionId;
    const state = requireState(
      createSolo(catalog, LEAGUE, seedFromString('same-person')).state,
      'create',
    );
    const withOffer1 = seasonDraftStateSchema.parse({
      ...state,
      currentOffer: handOffer(catalog, 'p1', 1, 1, [
        { playerVersionId: lakers90.playerVersionId, selectable: true, coverageReason: null },
      ]),
    });
    const first = applySeasonDraftCommand(
      withOffer1,
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
    const withOffer2 = seasonDraftStateSchema.parse({
      ...afterFirst,
      currentOffer: handOffer(catalog, 'p1', 2, 2, [
        { playerVersionId: lakers00.playerVersionId, selectable: true, coverageReason: null },
      ]),
    });
    const second = applySeasonDraftCommand(
      withOffer2,
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
  it('rejects the same player identity across duo human rosters', () => {
    const catalog = customCatalog([
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        positions: Array.from({ length: 12 }, (_, i) => (i < 5 ? ['PG'] : i < 10 ? ['SF'] : ['C'])),
      },
      {
        franchiseId: 'celtics',
        eraId: '1990s',
        positions: Array.from({ length: 12 }, (_, i) => (i < 5 ? ['PG'] : i < 10 ? ['SF'] : ['C'])),
      },
    ]);
    const lakers = catalog.candidates.find(
      (c) => c.franchiseId === 'lakers' && c.eraId === '1990s',
    );
    const celtics = catalog.candidates.find(
      (c) => c.franchiseId === 'celtics' && c.eraId === '1990s',
    );
    if (!lakers || !celtics) throw new Error('candidates missing');
    celtics.playerId = lakers.playerId;
    celtics.playerVersionId = `pv-${seasonDigestHex(`duo-${lakers.playerId}`)}`;
    const celticsPool = catalog.pools.find(
      (p) => p.franchiseId === 'celtics' && p.eraId === '1990s',
    );
    if (!celticsPool) throw new Error('pool missing');
    celticsPool.playerVersionIds[0] = celtics.playerVersionId;
    const created = createDuo(catalog, LEAGUE, seedFromString('duo-same-person'));
    const state = requireState(created.state, 'create');
    const firstPicker = state.currentTurnParticipantId;
    if (firstPicker === null) throw new Error('missing first picker');
    const secondPicker = firstPicker === 'p1' ? 'p2' : 'p1';
    const firstVersion = firstPicker === 'p1' ? lakers.playerVersionId : celtics.playerVersionId;
    const secondVersion = firstPicker === 'p1' ? celtics.playerVersionId : lakers.playerVersionId;
    const withOffer1 = seasonDraftStateSchema.parse({
      ...state,
      currentOffer: handOffer(catalog, firstPicker, 1, 1, [
        { playerVersionId: firstVersion, selectable: true, coverageReason: null },
      ]),
    });
    const first = applySeasonDraftCommand(
      withOffer1,
      catalog,
      cmd('c-pick-first', 1, {
        kind: 'select-draft-player',
        participantId: firstPicker,
        playerVersionId: firstVersion,
      }),
      fakeDeps(),
    );
    expectAccepted(first.record);
    const afterFirst = requireState(first.state, 'pick');
    const withOffer2 = seasonDraftStateSchema.parse({
      ...afterFirst,
      currentTurnParticipantId: secondPicker,
      currentOffer: handOffer(catalog, secondPicker, 1, 1, [
        { playerVersionId: secondVersion, selectable: true, coverageReason: null },
      ]),
    });
    const second = applySeasonDraftCommand(
      withOffer2,
      catalog,
      cmd('c-pick-second', 2, {
        kind: 'select-draft-player',
        participantId: secondPicker,
        playerVersionId: secondVersion,
      }),
      fakeDeps(),
    );
    expect(expectRejected(second.record).errorCode).toBe('OWNED_VERSION');
  });
});
describe('season draft exact version ownership', () => {
  it('never offers an exact version that was already picked, in any later offer', () => {
    const { state } = playFullDraft(
      FULL_CATALOG,
      LEAGUE,
      seedFromString('ownership'),
      fakeDeps(),
      ['p1', 'p2'],
      'ow',
    );
    const picksByOffer = new Map(
      state.offers.map((offer, index) => {
        const pick = state.picks[index];
        if (!pick) throw new Error(`no pick for offer ${String(index)}`);
        return [pick.playerVersionId, index] as const;
      }),
    );
    const pickedBefore = new Set<string>();
    state.offers.forEach((offer, index) => {
      for (const card of offer.cards) {
        const pickedAt = picksByOffer.get(card.playerVersionId);
        if (pickedAt !== undefined && pickedAt < index) {
          throw new Error(
            `offer ${String(index)} re-offers ${card.playerVersionId} picked at offer ${String(pickedAt)}`,
          );
        }
      }
      const ownPick = state.picks[index];
      if (ownPick !== undefined) pickedBefore.add(ownPick.playerVersionId);
    });
    expect(pickedBefore.size).toBe(state.offers.length);
    for (const offer of state.offers) {
      expect(new Set(offer.cards.map((c) => c.playerVersionId)).size).toBe(SEASON_DRAFT_OFFER_SIZE);
    }
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
  it('rejects legacy v1 commands with UNSUPPORTED_COMMAND', () => {
    const state = requireState(createSolo().state, 'create');
    const reveal = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-reveal', 1, { kind: 'reveal-draft-roll', participantId: 'p1' }),
      fakeDeps(),
    );
    expect(expectRejected(reveal.record).errorCode).toBe('UNSUPPORTED_COMMAND');
    const claim = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-claim', 1, {
        kind: 'claim-draft-pool',
        participantId: 'p1',
        franchiseId: franchiseIdSchema.parse('lakers'),
        eraId: eraIdSchema.parse('1990s'),
      }),
      fakeDeps(),
    );
    expect(expectRejected(claim.record).errorCode).toBe('UNSUPPORTED_COMMAND');
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
          diagnostics: {
            seed: SEED,
            aiVersion: 'season-ai-v2',
            rosterGenerationVersion: 'roster-generation-v2',
            teamsGenerated: 20,
            teamsRepaired: 0,
            backtracks: 0,
            nodesVisited: 100000,
            nodeBudget: 80000,
            failedTeams: [franchiseIdSchema.parse('lakers')],
            unmetConstraints: ['role perimeter-defense on 3 teams'],
          },
          phase: 'pool-fill',
          allocationState: '{}',
          repairs: 0,
        });
      },
    };
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
    const drawn = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-draw-dup', 1, { kind: 'draw-season-offer', participantId: 'p1' }),
      fakeDeps(),
    );
    const next = requireState(drawn.state, 'draw');
    const before = seasonDraftStateCanonical(next);
    const again = applySeasonDraftCommand(
      next,
      CATALOG,
      cmd('c-draw-dup', 1, { kind: 'draw-season-offer', participantId: 'p1' }),
      fakeDeps(),
    );
    expect(again.record).toEqual(drawn.record);
    expect(seasonDraftStateCanonical(requireState(again.state, 'replay'))).toBe(before);
  });
  it('rejects stale revisions and logs the rejection', () => {
    const state = requireState(createSolo().state, 'create');
    const before = seasonDraftStateCanonical(state);
    const stale = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-draw-stale', 99, { kind: 'draw-season-offer', participantId: 'p1' }),
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
    const versions = state.picks.map((p) => p.playerVersionId);
    expect(new Set(versions).size).toBe(versions.length);
    expect(state.offers.filter((o) => o.participantId === 'p1')).toHaveLength(10);
    expect(state.offers.filter((o) => o.participantId === 'p2')).toHaveLength(10);
    for (const pick of state.picks) {
      const offer = state.offers.find(
        (o) =>
          o.participantId === pick.participantId &&
          o.round === pick.round &&
          o.pickOrdinal === pick.pickOrdinal,
      );
      expect(offer).toBeDefined();
      expect(pick.seedPath).toEqual(offer?.seedPath);
    }
  });
  it('the AI generation never reuses a human-selected version', () => {
    const { state, generation } = playFullDraft(
      FULL_CATALOG,
      LEAGUE,
      seedFromString('ai-exclusion'),
      fakeDeps(),
      ['p1', 'p2'],
      'ai',
    );
    const humanOwned = new Set(state.picks.map((p) => p.playerVersionId));
    const humanFranchises = new Set(state.participants.map((p) => p.franchiseId));
    for (const roster of generation.rosters) {
      if (humanFranchises.has(roster.franchiseId)) continue;
      for (const player of roster.players) {
        expect(humanOwned.has(player.playerVersionId)).toBe(false);
      }
    }
    expect(generation.ownership).toHaveLength(300);
  });
});
describe('season draft offer seed derivation', () => {
  it('pins the documented seed path keys for a fixed turn', () => {
    const state = requireState(createSolo().state, 'create');
    const seed = seasonNamespaceSeed(SEED, 'draft', 'offer', 'p1', '1', '1');
    const safeSeed = seasonNamespaceSeed(seed, 'safe-order');
    const sampleSeed = seasonNamespaceSeed(seed, 'sample-order');
    expect(seed).toMatch(/^[0-9a-f]{32}$/);
    expect(safeSeed).not.toBe(seed);
    expect(sampleSeed).not.toBe(seed);
    expect(safeSeed).not.toBe(sampleSeed);
    const drawn = applySeasonDraftCommand(
      state,
      CATALOG,
      cmd('c-draw-1', 1, { kind: 'draw-season-offer', participantId: 'p1' }),
      fakeDeps(),
    );
    const offer = requireState(drawn.state, 'draw').currentOffer;
    expect(offer?.seedPath).toEqual([
      'draft',
      'offer',
      'p1',
      '1',
      '1',
      'safe-order',
      'sample-order',
    ]);
  });
  it('derives different offers for different seeds', () => {
    const a = requireState(
      createSolo(FULL_CATALOG, LEAGUE, seedFromString('offer-a')).state,
      'create',
    );
    const b = requireState(
      createSolo(FULL_CATALOG, LEAGUE, seedFromString('offer-b')).state,
      'create',
    );
    const offerA = requireState(
      applySeasonDraftCommand(
        a,
        FULL_CATALOG,
        cmd('c-draw-a', 1, { kind: 'draw-season-offer', participantId: 'p1' }),
        fakeDeps(),
      ).state,
      'draw-a',
    ).currentOffer;
    const offerB = requireState(
      applySeasonDraftCommand(
        b,
        FULL_CATALOG,
        cmd('c-draw-b', 1, { kind: 'draw-season-offer', participantId: 'p1' }),
        fakeDeps(),
      ).state,
      'draw-b',
    ).currentOffer;
    expect(offerA?.cards.map((c) => c.playerVersionId)).not.toEqual(
      offerB?.cards.map((c) => c.playerVersionId),
    );
  });
});
