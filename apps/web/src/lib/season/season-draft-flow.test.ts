import { describe, expect, it } from 'vitest';
import {
  SEASON_AI_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROTATION_VERSION,
  type SeasonDraftState,
  type SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';
import type { SeasonDraftRepository, StoredSeasonDraft } from '@hoop-rush/persistence';
import {
  buildSeasonAiAssignments,
  buildSeasonAiPools,
  buildSeasonDraftCatalog,
  buildSeasonLeague,
  buildSeasonRotation,
  buildSeasonRosters,
  buildFixtureEvaluations,
} from '@hoop-rush/test-fixtures';
import { SOLO_PARTICIPANT_ID, SeasonDraftFlow, coverageNeeds } from './season-draft-flow';
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
    schemaVersion: 2,
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
    aiPools: buildSeasonAiPools(aiAssignments, 'lakers'),
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
async function pickBestFromOffer(flow: SeasonDraftFlow): Promise<void> {
  const state = flow.draft;
  if (state === null) throw new Error('expected a draft state');
  const offer = state.currentOffer;
  if (offer === null) throw new Error('expected a drawn offer');
  const selectable = offer.cards.filter((card) => card.selectable);
  expect(selectable.length).toBeGreaterThanOrEqual(3);
  const byId = new Map(CATALOG.candidates.map((c) => [c.playerVersionId, c]));
  const best = [...selectable].sort(
    (a, b) =>
      (byId.get(b.playerVersionId)?.summaryRatings.overallRating ?? 0) -
        (byId.get(a.playerVersionId)?.summaryRatings.overallRating ?? 0) ||
      a.playerVersionId.localeCompare(b.playerVersionId),
  )[0];
  if (!best) throw new Error('no selectable card');
  const pick = await flow.pick(SOLO_PARTICIPANT_ID, best.playerVersionId);
  expect(pick.status).toBe('accepted');
}
async function draftFullSeason(flow: SeasonDraftFlow) {
  await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
  for (let round = 1; round <= 10; round += 1) {
    const draw = await flow.draw();
    expect(draw.status).toBe('accepted');
    const state = flow.draft as SeasonDraftState;
    const offer = state.currentOffer;
    if (offer === null) {
      throw new Error('expected a drawn offer');
    }
    expect(offer.cards).toHaveLength(8);
    expect(new Set(offer.cards.map((card) => card.playerVersionId)).size).toBe(8);
    expect(offer.cards.filter((card) => card.selectable).length).toBeGreaterThanOrEqual(3);
    await pickBestFromOffer(flow);
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
    expect(draft.draftVersion).toBe(SEASON_DRAFT_VERSION);
  });
  it('draws a deterministic eight-card offer with at least three selectable cards', async () => {
    const flow = makeFlow(new InMemorySeasonDraftRepository());
    await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    const draw = await flow.draw();
    expect(draw.status).toBe('accepted');
    const draft = flow.draft;
    if (draft === null) {
      throw new Error('expected the draft to be created');
    }
    const offer = draft.currentOffer;
    if (offer === null) {
      throw new Error('expected a drawn offer');
    }
    expect(offer.cards).toHaveLength(8);
    expect(new Set(offer.cards.map((card) => card.playerVersionId)).size).toBe(8);
    const selectable = offer.cards.filter((card) => card.selectable);
    expect(selectable.length).toBeGreaterThanOrEqual(3);
    for (const card of offer.cards) {
      if (card.selectable) {
        expect(card.coverageReason).toBeNull();
      } else {
        expect(card.coverageReason).not.toBeNull();
      }
    }
    expect(offer.seedPath).toEqual([
      'draft',
      'offer',
      SOLO_PARTICIPANT_ID,
      '1',
      '1',
      'safe-order',
      'sample-order',
    ]);
  });
  it('rejects a pick when no offer is drawn (typed rejection, no state change)', async () => {
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
      expect(pick.errorCode).toBe('NO_OFFER_DRAWN');
    }
    expect(draft.revision).toBe(revisionBefore);
    expect(flow.error).not.toBeNull();
  });
  it('rejects a disabled card with the coverage reason surfaced', async () => {
    const flow = makeFlow(new InMemorySeasonDraftRepository());
    await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    await flow.draw();
    const draft = flow.draft;
    if (draft === null) throw new Error('expected the draft to be created');
    const disabled = draft.currentOffer?.cards.find((card) => !card.selectable);
    if (disabled === undefined) return;
    const pick = await flow.pick(SOLO_PARTICIPANT_ID, disabled.playerVersionId);
    expect(pick.status).toBe('rejected');
    if (pick.status === 'rejected') {
      expect(pick.errorCode).toBe('UNCOMPLETABLE_ROSTER');
      expect(pick.message).toContain('completion targets unreachable');
    }
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
    expect(draft.offers).toHaveLength(10);
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
    const stored = await repo.loadSeasonDraft();
    expect(stored).not.toBeNull();
    expect(stored?.generation).not.toBeNull();
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
  it('loads a stored current record directly as the playable draft', async () => {
    const repo = new InMemorySeasonDraftRepository();
    const flow = makeFlow(repo);
    await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    const reloaded = makeFlow(repo);
    const found = await reloaded.load();
    expect(found).toBe(true);
    expect(reloaded.draft).not.toBeNull();
    expect(reloaded.draft?.status).toBe('drafting');
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
  it('records duplicate draw commands idempotently through the engine', async () => {
    const flow = makeFlow(new InMemorySeasonDraftRepository());
    await flow.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    const draw = await flow.draw();
    expect(draw.status).toBe('accepted');
    const offerBefore = flow.draft?.currentOffer;
    const secondDraw = await flow.draw();
    expect(secondDraw.status).toBe('accepted');
    expect(flow.draft?.currentOffer).toEqual(offerBefore);
    expect(flow.draft?.offers).toHaveLength(1);
  });
});
describe('SeasonDraftFlow construction', () => {
  it('rejects creation against a malformed catalog with INVALID_CATALOG', async () => {
    const badCatalog = { ...CATALOG, pools: [] };
    const broken = new SeasonDraftFlow(new InMemorySeasonDraftRepository(), badCatalog, {
      generate: () => fakeGeneration(),
    });
    const record = await broken.create({ rootSeed: ROOT_SEED, league: LEAGUE });
    expect(record.status).toBe('rejected');
  });
});
