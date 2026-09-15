import { describe, expect, it } from 'vitest';
import {
  seedSchema,
  type SeasonDraftCatalog,
  type SeasonDraftState,
} from '@hoop-rush/data-contracts';
import {
  buildSeasonDraftCatalog,
  buildSeasonLeague,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { applySeasonDraftCommand, type SeasonAiGenerationDeps } from './draft.ts';
import {
  isFloorCandidate,
  isStarCandidate,
  floorTierWeight,
  scriptedRoundsFor,
  scriptKindFor,
  starTierWeight,
} from './draft-script.ts';

const FULL_CATALOG = buildSeasonDraftCatalog({
  franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
  eras: ['1980s', '1990s', '2000s', '2010s'],
  playersPerPool: 40,
});
const LEAGUE = buildSeasonLeague();

function fakeDeps(): SeasonAiGenerationDeps {
  return {
    generate: () => {
      throw new Error('no generation in script tests');
    },
  };
}

function createSolo(rootSeed: string, catalog: SeasonDraftCatalog = FULL_CATALOG) {
  const result = applySeasonDraftCommand(
    null,
    catalog,
    {
      commandId: 'c-create',
      expectedRevision: 0,
      payload: {
        kind: 'create-season-draft',
        runId: 'run-1',
        rootSeed: seedSchema.parse(seedFromString(rootSeed)),
        league: LEAGUE,
        humanParticipantIds: ['human'],
        catalogVersion: 'season-draft-v4',
      },
    },
    fakeDeps(),
  );
  if (result.state === null) throw new Error('create failed');
  return result.state;
}

function drawOffer(state: SeasonDraftState, catalog: SeasonDraftCatalog, sequence: number) {
  const pid = state.currentTurnParticipantId;
  if (pid === null) throw new Error('no turn');
  const drawn = applySeasonDraftCommand(
    state,
    catalog,
    {
      commandId: `c-draw-${String(sequence)}`,
      expectedRevision: state.revision,
      payload: { kind: 'draw-season-offer', participantId: pid },
    },
    fakeDeps(),
  );
  if (drawn.state === null || drawn.state.currentOffer === null) {
    throw new Error('draw failed');
  }
  return drawn.state;
}

function pickFirstSelectable(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  sequence: number,
) {
  const offer = state.currentOffer;
  if (offer === null) throw new Error('no offer');
  const card = offer.cards.find((c) => c.selectable);
  if (!card) throw new Error('no selectable card');
  const picked = applySeasonDraftCommand(
    state,
    catalog,
    {
      commandId: `c-pick-${String(sequence)}`,
      expectedRevision: state.revision,
      payload: {
        kind: 'select-draft-player',
        participantId: offer.participantId,
        playerVersionId: card.playerVersionId,
      },
    },
    fakeDeps(),
  );
  if (picked.state === null) throw new Error('pick failed');
  return picked.state;
}

describe('draft script tiers', () => {
  it('weights stars non-linearly', () => {
    expect(starTierWeight(86)).toBe(40);
    expect(starTierWeight(89)).toBe(30);
    expect(starTierWeight(92)).toBe(15);
    expect(starTierWeight(95)).toBe(10);
    expect(starTierWeight(98)).toBe(5);
    expect(starTierWeight(84)).toBe(0);
    expect(starTierWeight(100)).toBe(0);
    expect(floorTierWeight(79)).toBe(40);
    expect(floorTierWeight(75)).toBe(30);
    expect(floorTierWeight(72)).toBe(15);
    expect(floorTierWeight(69)).toBe(10);
    expect(floorTierWeight(60)).toBe(5);
    expect(floorTierWeight(81)).toBe(0);
  });

  it('assigns exactly 1 star and 2 floor rounds deterministically', () => {
    const a = scriptedRoundsFor('seed-a');
    const b = scriptedRoundsFor('seed-a');
    expect([...a.stars].sort()).toEqual([...b.stars].sort());
    expect([...a.floors].sort()).toEqual([...b.floors].sort());
    expect(a.stars.size).toBe(1);
    expect(a.floors.size).toBe(2);
    for (const ordinal of a.stars) {
      expect(a.floors.has(ordinal)).toBe(false);
      expect(scriptKindFor('seed-a', ordinal)).toBe('star');
    }
    for (const ordinal of a.floors) {
      expect(scriptKindFor('seed-a', ordinal)).toBe('floor');
    }
    const c = scriptedRoundsFor('seed-b');
    expect([...a.stars].sort()).not.toEqual([...c.stars].sort());
  });
});

describe('draft script offers', () => {
  it('seeds at least 1 star and 2 floor rounds across ten offers', () => {
    let state = createSolo('script-opportunity-seed');
    const byId = new Map(FULL_CATALOG.candidates.map((c) => [c.playerVersionId, c]));
    let starOffers = 0;
    let floorOffers = 0;
    for (let sequence = 0; sequence < 10; sequence += 1) {
      state = drawOffer(state, FULL_CATALOG, sequence);
      const offer = state.currentOffer;
      if (offer === null) throw new Error('missing offer');
      const selectable = offer.cards.filter((card) => card.selectable);
      expect(selectable.length).toBeGreaterThanOrEqual(3);
      const scriptedKind = scriptKindFor(state.rootSeed, offer.round);
      if (scriptedKind !== null) {
        expect(
          offer.cards.every((card) => {
            const candidate = byId.get(card.playerVersionId);
            return (
              candidate !== undefined &&
              (scriptedKind === 'star' ? isStarCandidate(candidate) : isFloorCandidate(candidate))
            );
          }),
        ).toBe(true);
      }
      const hasStar = selectable.some((card) => {
        const candidate = byId.get(card.playerVersionId);
        return candidate !== undefined && isStarCandidate(candidate);
      });
      const hasFloor = selectable.some((card) => {
        const candidate = byId.get(card.playerVersionId);
        return candidate !== undefined && isFloorCandidate(candidate);
      });
      if (hasStar) starOffers += 1;
      if (hasFloor) floorOffers += 1;
      state = pickFirstSelectable(state, FULL_CATALOG, sequence);
    }
    expect(starOffers).toBeGreaterThanOrEqual(1);
    expect(floorOffers).toBeGreaterThanOrEqual(2);
  });

  it('reproduces scripted offers byte-for-byte for the same seed', () => {
    const walk = (seed: string) => {
      let state = createSolo(seed);
      for (let sequence = 0; sequence < 10; sequence += 1) {
        state = drawOffer(state, FULL_CATALOG, sequence);
        state = pickFirstSelectable(state, FULL_CATALOG, sequence);
      }
      return state;
    };
    const first = walk('script-repro-seed');
    const second = walk('script-repro-seed');
    expect(first.offers).toEqual(second.offers);
    expect(first.picks).toEqual(second.picks);
  });
});
