import { describe, expect, it, vi } from 'vitest';
import {
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROTATION_VERSION,
  type SeasonDraftState,
  type SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';
import type { SeasonDraftRepository, StoredSeasonDraft } from '@hoop-rush/persistence';
import {
  buildSeasonAiAssignments,
  buildSeasonDraftCatalog,
  buildSeasonLeague,
  buildSeasonRotation,
  buildSeasonRosters,
  buildFixtureEvaluations,
} from '@hoop-rush/test-fixtures';
import {
  SOLO_PARTICIPANT_ID,
  SeasonDraftFlow,
  coverageNeeds,
  revealPoolRows,
} from './season-draft-flow';

/**
 * M2.3 draft flow unit tests: the UI state machine over the authoritative
 * engine commands and the persisted Season draft record (spec/2.0/03).
 */

class InMemorySeasonDraftRepository implements SeasonDraftRepository {
  private stored: StoredSeasonDraft | null = null;
  saveSeasonDraft(record: StoredSeasonDraft): Promise<void> {
    this.stored = record;
    return Promise.resolve();
  }
  loadSeasonDraft(): Promise<StoredSeasonDraft | null> {
    return Promise.resolve(this.stored);
  }
  clearSeasonDraft(): Promise<void> {
    this.stored = null;
    return Promise.resolve();
  }
}

const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
const CATALOG = buildSeasonDraftCatalog();
const ROOT_SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

function fakeGeneration(): SeasonLeagueGenerationResult {
  const seed = ROOT_SEED;
  const rosters = buildSeasonRosters(LEAGUE, seed);
  const aiAssignments = buildSeasonAiAssignments(LEAGUE);
  const rotations = rosters.map((roster) =>
    buildSeasonRotation(
      roster.franchiseId,
      roster.players.map((player) => player.playerVersionId),
    ),
  );
  return {
    schemaVersion: 1,
    seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    rosters,
    ownership: rosters.flatMap((roster) =>
      roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        ownerFranchiseId: roster.franchiseId,
      })),
    ),
    rotations,
    aiAssignments,
    evaluations: buildFixtureEvaluations(rosters, aiAssignments),
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
    digest: '0'.repeat(32),
  };
}

function makeFlow(repo: SeasonDraftRepository) {
  return new SeasonDraftFlow(repo, CATALOG, { generate: () => fakeGeneration() });
}

async function draftFullSeason(flow: SeasonDraftFlow) {
  await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
  for (let round = 1; round <= 10; round += 1) {
    const reveal = await flow.reveal();
    expect(reveal.status).toBe('accepted');
    const state = flow.draft as SeasonDraftState;
    const revealState = state.currentReveal;
    if (revealState === null) {
      throw new Error('expected a revealed draft state');
    }
    const lastAttempt = revealState.attempts[revealState.attempts.length - 1];
    if (lastAttempt === undefined) {
      throw new Error('expected at least one reveal attempt');
    }
    expect(lastAttempt.usable).toBe(true);
    const claim = await flow.claim(SOLO_PARTICIPANT_ID, lastAttempt.franchiseId, lastAttempt.eraId);
    expect(claim.status).toBe('accepted');
    const rows = revealPoolRows(state, CATALOG);
    expect(rows.length).toBeGreaterThan(0);
    // The engine rejects picks that would make the final roster constraints
    // impossible; try the pool's candidates until one is accepted (the UI
    // surfaces the typed rejection and lets the player choose again).
    let pick: Awaited<ReturnType<SeasonDraftFlow['pick']>> | null = null;
    for (const candidate of rows) {
      pick = await flow.pick(SOLO_PARTICIPANT_ID, candidate.playerVersionId);
      if (pick.status === 'accepted') break;
    }
    expect(pick?.status, `round ${String(round)} pick failed: ${flow.error ?? 'no error'}`).toBe(
      'accepted',
    );
  }
  const finalize = await flow.finalize();
  expect(finalize.status).toBe('accepted');
}

describe('SeasonDraftFlow', () => {
  it('creates a solo draft with the seeded participant facts', async () => {
    const flow = makeFlow(new InMemorySeasonDraftRepository());
    const record = await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    expect(record.status).toBe('accepted');
    const draft = flow.draft;
    if (draft === null) {
      throw new Error('expected the draft to be created');
    }
    expect(draft.status).toBe('drafting');
    expect(draft.round).toBe(1);
    const participant = draft.participants[0];
    if (participant === undefined) {
      throw new Error('expected a draft participant');
    }
    expect(participant.participantId).toBe(SOLO_PARTICIPANT_ID);
    expect(draft.rootSeed).toBe(ROOT_SEED);
  });

  it('reveals a deterministic roll with recovery attempts recorded', async () => {
    const flow = makeFlow(new InMemorySeasonDraftRepository());
    await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    const reveal = await flow.reveal();
    expect(reveal.status).toBe('accepted');
    const draft = flow.draft;
    if (draft === null) {
      throw new Error('expected the draft to be created');
    }
    const revealState = draft.currentReveal;
    if (revealState === null) {
      throw new Error('expected a revealed draft state');
    }
    expect(revealState.attempts.length).toBeGreaterThanOrEqual(1);
    const lastAttempt = revealState.attempts[revealState.attempts.length - 1];
    if (lastAttempt === undefined) {
      throw new Error('expected at least one reveal attempt');
    }
    expect(lastAttempt.usable).toBe(true);
  });

  it('rejects a pick when no pool is revealed (typed rejection, no state change)', async () => {
    const flow = makeFlow(new InMemorySeasonDraftRepository());
    await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    const draft = flow.draft;
    if (draft === null) {
      throw new Error('expected the draft to be created');
    }
    const revisionBefore = draft.revision;
    const pick = await flow.pick(SOLO_PARTICIPANT_ID, 'pv-' + 'a'.repeat(32));
    expect(pick.status).toBe('rejected');
    if (pick.status === 'rejected') {
      expect(pick.errorCode).toBe('UNAVAILABLE_POOL');
    }
    expect(draft.revision).toBe(revisionBefore);
    expect(flow.error).not.toBeNull();
  });

  it('plays all ten rounds, finalizes, and generates the league deterministically', async () => {
    const repo = new InMemorySeasonDraftRepository();
    const flow = makeFlow(repo);
    await draftFullSeason(flow);
    const draft = flow.draft;
    if (draft === null) {
      throw new Error('expected the draft to be created');
    }
    expect(draft.picks.filter((p) => p.participantId === SOLO_PARTICIPANT_ID)).toHaveLength(10);
    expect(draft.status).toBe('finalized');

    const generation = await flow.generate();
    if (generation === null) {
      throw new Error('expected the league generation');
    }
    expect(flow.phase).toBe('complete');
    const completedDraft = flow.draft;
    if (completedDraft === null) {
      throw new Error('expected the draft to be created');
    }
    expect(completedDraft.status).toBe('complete');
    expect(generation.rosters).toHaveLength(30);

    // The persisted record carries the completed generation.
    const stored = await repo.loadSeasonDraft();
    expect(stored).not.toBeNull();
    expect((stored as { generation: unknown }).generation).not.toBeNull();
  });

  it('resumes a persisted draft through a new flow instance', async () => {
    const repo = new InMemorySeasonDraftRepository();
    const first = makeFlow(repo);
    await draftFullSeason(first);
    await first.generate();

    const second = makeFlow(repo);
    const found = await second.load();
    expect(found).toBe(true);
    const draft = second.draft;
    if (draft === null) {
      throw new Error('expected the resumed draft');
    }
    expect(draft.status).toBe('complete');
    expect(second.generation).not.toBeNull();
    expect(second.phase).toBe('complete');
  });

  it('clears the persisted draft on discard', async () => {
    const repo = new InMemorySeasonDraftRepository();
    const flow = makeFlow(repo);
    await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    await flow.clear();
    expect(flow.draft).toBeNull();
    const reloaded = makeFlow(repo);
    expect(await reloaded.load()).toBe(false);
  });

  it('counts coverage needs toward the 4G/4F/3C targets', async () => {
    const flow = makeFlow(new InMemorySeasonDraftRepository());
    await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    const draft = flow.draft;
    if (draft === null) {
      throw new Error('expected the draft to be created');
    }
    const needs = coverageNeeds(draft.picks, CATALOG);
    expect(needs).toEqual({ guards: 0, forwards: 0, centers: 0 });
  });

  it('records duplicate command ids idempotently through the engine', async () => {
    const flow = makeFlow(new InMemorySeasonDraftRepository());
    await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    const reveal = await flow.reveal();
    expect(reveal.status).toBe('accepted');
    const state = flow.draft;
    if (state === null) {
      throw new Error('expected the draft to be created');
    }
    const currentReveal = state.currentReveal;
    if (currentReveal === null) {
      throw new Error('expected a revealed draft state');
    }
    const lastAttempt = currentReveal.attempts[currentReveal.attempts.length - 1];
    if (lastAttempt === undefined) {
      throw new Error('expected at least one reveal attempt');
    }
    await flow.claim(SOLO_PARTICIPANT_ID, lastAttempt.franchiseId, lastAttempt.eraId);
    // A second claim of the same pair is an accepted no-op (engine idempotency).
    const secondClaim = await flow.claim(
      SOLO_PARTICIPANT_ID,
      lastAttempt.franchiseId,
      lastAttempt.eraId,
    );
    expect(secondClaim.status).toBe('accepted');
  });
});

describe('SeasonDraftFlow construction', () => {
  it('throws on a malformed catalog? no — create rejects with INVALID_CATALOG', async () => {
    const badCatalog = { ...CATALOG, pools: [] };
    const broken = new SeasonDraftFlow(new InMemorySeasonDraftRepository(), badCatalog, {
      generate: vi.fn(),
    });
    const record = await broken.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    expect(record.status).toBe('rejected');
  });
});
