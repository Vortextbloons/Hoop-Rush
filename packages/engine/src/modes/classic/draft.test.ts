import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildFixtureBracket,
  buildGameSimulationInput,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import type {
  ClassicDraftCatalog,
  ClassicDraftCatalogEntry,
  ClassicDraftState,
  ClassicVariant,
} from '@hoop-rush/data-contracts';
import { challengeRunSchema } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/context.ts';
import { canPlay } from '../../domain/positions.ts';
import { createChallenge } from '../../challenge/commands.ts';
import {
  classicRerollAvailable,
  classicRollCandidates,
  classicRollSeed,
  createClassicChallenge,
  createClassicDraft,
  draftClassicPlayer,
  repositionClassicPlayer,
  rerollClassicEra,
  rerollClassicFranchise,
  slotRequirement,
  sortClassicCatalog,
  type ClassicChallengeEnvironment,
} from './draft.ts';

const context = createEngineContext();

function catalogFixture(): ClassicDraftCatalog {
  return [
    { franchiseId: 'bulls', eraId: '1990s', players: [{ playerId: 'p-7', positions: ['PG'] }] },
    { franchiseId: 'bulls', eraId: '2010s', players: [{ playerId: 'p-11', positions: ['SF'] }] },
    {
      franchiseId: 'celtics',
      eraId: '1990s',
      players: [
        { playerId: 'p-4', positions: ['PG'] },
        { playerId: 'p-5', positions: ['C'] },
      ],
    },
    { franchiseId: 'celtics', eraId: '2010s', players: [{ playerId: 'p-10', positions: ['C'] }] },
    { franchiseId: 'heat', eraId: '2000s', players: [{ playerId: 'p-8', positions: ['PF', 'C'] }] },
    { franchiseId: 'lakers', eraId: '1980s', players: [{ playerId: 'p-6', positions: ['SF'] }] },
    {
      franchiseId: 'lakers',
      eraId: '1990s',
      players: [
        { playerId: 'p-1', positions: ['PG'] },
        { playerId: 'p-2', positions: ['PG', 'SF'] },
        { playerId: 'p-3', positions: ['C'] },
      ],
    },
    { franchiseId: 'lakers', eraId: '2010s', players: [{ playerId: 'p-9', positions: ['SG'] }] },
  ];
}

function entryOf(
  catalog: ClassicDraftCatalog,
  franchiseId: string,
  eraId: string,
): ClassicDraftCatalogEntry {
  const entry = catalog.find((e) => e.franchiseId === franchiseId && e.eraId === eraId);
  if (!entry) throw new Error(`catalog has no ${franchiseId}/${eraId} entry`);
  return entry;
}

function draftFixture(variant: ClassicVariant = 'ratings'): ClassicDraftState {
  return createClassicDraft(
    {
      draftId: 'draft-1',
      variant,
      seed: seedFromString('classic-fixture'),
      dataVersion: 'data-v1',
      catalog: catalogFixture(),
    },
    context,
  );
}

function advanceOne(state: ClassicDraftState): ClassicDraftState {
  if (state.roll === null) {
    throw new Error('fixture cannot advance without a roll');
  }
  const entry = entryOf(catalogFixture(), state.roll.franchiseId, state.roll.eraId);
  const openSlots = [0, 1, 2, 3, 4].filter(
    (slotIndex) => !state.picks.some((p) => p.slotIndex === slotIndex),
  );
  for (const slotIndex of openSlots) {
    const requirement = slotRequirement(slotIndex);
    const player = entry.players.find(
      (p) =>
        !state.picks.some((pick) => pick.playerId === p.playerId) &&
        canPlay(p.positions, requirement),
    );
    if (player) {
      return draftClassicPlayer(
        state,
        catalogFixture(),
        { playerId: player.playerId, slotIndex: slotIndex },
        context,
      );
    }
  }
  throw new Error('fixture cannot advance: no legal pick');
}

function draftFive(state: ClassicDraftState): ClassicDraftState {
  let current = state;
  while (current.status === 'drafting') {
    current = advanceOne(current);
  }
  return current;
}

function positionsFor(playerId: string): ClassicDraftCatalogEntry['players'][number]['positions'] {
  for (const entry of catalogFixture()) {
    const player = entry.players.find((p) => p.playerId === playerId);
    if (player) return player.positions;
  }
  throw new Error(`unknown catalog player ${playerId}`);
}

function challengeEnvironment(
  draft: ClassicDraftState,
  overrides: Partial<ClassicChallengeEnvironment> = {},
): ClassicChallengeEnvironment {
  const players = draft.picks
    .map((pick) => ({ pick, positions: positionsFor(pick.playerId) }))
    .sort((a, b) => a.pick.slotIndex - b.pick.slotIndex)
    .map(({ pick, positions }) =>
      buildSimulationPlayer({
        playerId: pick.playerId,
        displayName: `Player ${pick.playerId}`,
        positions,
      }),
    );
  return {
    runId: 'run-classic',
    runSeed: seedFromString('classic-run'),
    players,
    dataVersion: 'data-v1',
    ratingVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v2',
    engineVersion: context.engineVersion,
    profile: buildGameSimulationInput().profile,
    bracket: buildFixtureBracket(),
    eraId: '1990s',
    homeDisplayName: 'Classic Five',
    ...overrides,
  };
}

function completeFixture(overrides: Partial<ClassicDraftState> = {}): ClassicDraftState {
  return {
    ...draftFixture(),
    round: 5,
    status: 'complete',
    roll: null,
    picks: [
      { round: 1, playerId: 'p-1', franchiseId: 'lakers', eraId: '1990s', slotIndex: 0 },
      { round: 2, playerId: 'p-4', franchiseId: 'celtics', eraId: '1990s', slotIndex: 1 },
      { round: 3, playerId: 'p-6', franchiseId: 'lakers', eraId: '1980s', slotIndex: 2 },
      { round: 4, playerId: 'p-11', franchiseId: 'bulls', eraId: '2010s', slotIndex: 3 },
      { round: 5, playerId: 'p-3', franchiseId: 'lakers', eraId: '1990s', slotIndex: 4 },
    ],
    ...overrides,
  };
}

function decoyFixture(): ClassicDraftCatalog {
  return [
    {
      franchiseId: 'bulls',
      eraId: '1990s',
      players: [{ playerId: 'decoy-bulls-1990s', positions: ['PG'] }],
    },
    {
      franchiseId: 'bulls',
      eraId: '2010s',
      players: [{ playerId: 'decoy-bulls-2010s', positions: ['PG', 'SF'] }],
    },
    {
      franchiseId: 'celtics',
      eraId: '1980s',
      players: [{ playerId: 'decoy-celtics-1980s', positions: ['PG', 'SF', 'C'] }],
    },
    {
      franchiseId: 'celtics',
      eraId: '1990s',
      players: [{ playerId: 'decoy-celtics-1990s', positions: ['SG'] }],
    },
    {
      franchiseId: 'heat',
      eraId: '2000s',
      players: [{ playerId: 'decoy-heat-2000s', positions: ['PG'] }],
    },
    {
      franchiseId: 'knicks',
      eraId: '2010s',
      players: [{ playerId: 'decoy-knicks-2010s', positions: ['PG'] }],
    },
    {
      franchiseId: 'lakers',
      eraId: '1980s',
      players: [{ playerId: 'decoy-lakers-1980s', positions: ['PG', 'SF'] }],
    },
    {
      franchiseId: 'lakers',
      eraId: '1990s',
      players: [{ playerId: 'decoy-lakers-1990s', positions: ['PG', 'SF', 'C'] }],
    },
    {
      franchiseId: 'lakers',
      eraId: '2000s',
      players: [{ playerId: 'decoy-lakers-2000s', positions: ['C'] }],
    },
    {
      franchiseId: 'spurs',
      eraId: '1980s',
      players: [{ playerId: 'decoy-spurs-1980s', positions: ['PG', 'SF', 'C'] }],
    },
  ];
}

function decoyState(overrides: Partial<ClassicDraftState> = {}): ClassicDraftState {
  return {
    ...draftFixture(),
    seed: seedFromString('decoy-fixture'),
    round: 1,
    status: 'drafting',
    roll: { franchiseId: 'lakers', eraId: '1990s' },
    picks: [],
    rerolls: { franchiseSpent: false, eraSpent: false },
    ...overrides,
  };
}

describe('classic roll seeds', () => {
  it('are byte-identical for the same inputs and distinct otherwise', () => {
    const seed = seedFromString('seed-a');
    const version = 'classic-roll-v1';
    expect(classicRollSeed(seed, version, 'initial', 1)).toBe(
      classicRollSeed(seed, version, 'initial', 1),
    );
    expect(classicRollSeed(seed, version, 'initial', 1)).not.toBe(
      classicRollSeed(seed, version, 'initial', 2),
    );
    expect(classicRollSeed(seed, version, 'initial', 1)).not.toBe(
      classicRollSeed(seed, version, 'franchise-reroll', 1),
    );
    expect(classicRollSeed(seed, version, 'franchise-reroll', 1)).not.toBe(
      classicRollSeed(seed, version, 'era-reroll', 1),
    );
  });

  it('include the saved seed, version, kind, and round in that order', () => {
    const seed = seedFromString('seed-b');
    expect(classicRollSeed(seed, 'v1', 'initial', 3)).toBe(`${seed}:classic-roll:v1:initial:3`);
  });
});

describe('classic draft determinism', () => {
  it('createClassicDraft with the same seed yields identical states', () => {
    const first = draftFixture();
    const second = draftFixture();
    expect(second).toEqual(first);
    expect(second.roll).toEqual(first.roll);
    expect(second.roll).not.toBeNull();
  });

  it('rerolls at the same round from identical states are identical', () => {
    const catalog = catalogFixture();
    const franchiseA = rerollClassicFranchise(draftFixture(), catalog, context);
    const franchiseB = rerollClassicFranchise(draftFixture(), catalog, context);
    expect(franchiseB).toEqual(franchiseA);
    const eraA = rerollClassicEra(draftFixture(), catalog, context);
    const eraB = rerollClassicEra(draftFixture(), catalog, context);
    expect(eraB).toEqual(eraA);
  });

  it('variants produce identical rolls and picks for the same seed', () => {
    const ratings = draftFive(draftFixture('ratings'));
    const knowledge = draftFive(draftFixture('ball-knowledge'));
    expect(knowledge.picks).toEqual(ratings.picks);
    expect(knowledge.roll).toEqual(ratings.roll);
  });

  it('sorts the catalog canonically by franchise then era', () => {
    const shuffled = [...catalogFixture()].reverse();
    const sorted = sortClassicCatalog(shuffled);
    expect(sorted.map((e) => `${e.franchiseId}/${e.eraId}`)).toEqual([
      'bulls/1990s',
      'bulls/2010s',
      'celtics/1990s',
      'celtics/2010s',
      'heat/2000s',
      'lakers/1980s',
      'lakers/1990s',
      'lakers/2010s',
    ]);
  });
});

describe('classic draft rounds', () => {
  it('completes five legal picks with unique players and slots', () => {
    const done = draftFive(draftFixture());
    expect(done.status).toBe('complete');
    expect(done.picks).toHaveLength(5);
    expect(new Set(done.picks.map((p) => p.playerId)).size).toBe(5);
    expect(new Set(done.picks.map((p) => p.slotIndex)).size).toBe(5);
    expect(done.round).toBe(5);
    expect(done.roll).toBeNull();
    expect(done.picks.map((p) => p.round)).toEqual([1, 2, 3, 4, 5]);
  });

  it('every initial roll offers an undrafted player for an open slot', () => {
    let state = draftFixture();
    while (state.status === 'drafting') {
      if (state.roll === null) throw new Error('drafting state must carry a roll');
      const entry = entryOf(catalogFixture(), state.roll.franchiseId, state.roll.eraId);
      const openSlots = [0, 1, 2, 3, 4].filter(
        (slotIndex) => !state.picks.some((p) => p.slotIndex === slotIndex),
      );
      const fitting = entry.players.some(
        (player) =>
          !state.picks.some((pick) => pick.playerId === player.playerId) &&
          openSlots.some((slotIndex) => canPlay(player.positions, slotRequirement(slotIndex))),
      );
      expect(fitting).toBe(true);
      state = advanceOne(state);
    }
  });

  it('advances exactly one round per pick and stays drafting below five', () => {
    const state = draftFixture();
    const next = draftClassicPlayer(
      { ...state, roll: { franchiseId: 'lakers', eraId: '1990s' } },
      catalogFixture(),
      { playerId: 'p-1', slotIndex: 0 },
      context,
    );
    expect(next.status).toBe('drafting');
    expect(next.picks).toHaveLength(1);
    expect(next.round).toBe(2);
    expect(next.roll).not.toBeNull();
  });

  it('rejects an empty or unfittable catalog at creation', () => {
    expect(() =>
      createClassicDraft(
        {
          draftId: 'draft-bad',
          variant: 'ratings',
          seed: seedFromString('bad'),
          dataVersion: 'data-v1',
          catalog: [],
        },
        context,
      ),
    ).toThrow(/catalog is invalid/);
    expect(() =>
      createClassicDraft(
        {
          draftId: 'draft-bad',
          variant: 'ratings',
          seed: seedFromString('bad'),
          dataVersion: 'data-v1',
          catalog: [{ franchiseId: 'lakers', eraId: '1990s', players: [] }],
        },
        context,
      ),
    ).toThrow(/no eligible pool for round 1/);
  });
});

describe('classic rerolls', () => {
  it('franchise reroll changes the franchise, preserves the era, and spends once', () => {
    const catalog: ClassicDraftCatalog = [
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        players: [
          { playerId: 'p-1', positions: ['PG'] },
          { playerId: 'p-2', positions: ['PG', 'SF'] },
          { playerId: 'p-3', positions: ['SF'] },
          { playerId: 'p-5', positions: ['C'] },
        ],
      },
      {
        franchiseId: 'celtics',
        eraId: '1990s',
        players: [
          { playerId: 'p-4', positions: ['PG'] },
          { playerId: 'p-6', positions: ['SF'] },
        ],
      },
      {
        franchiseId: 'bulls',
        eraId: '1990s',
        players: [{ playerId: 'p-7', positions: ['PG'] }],
      },
    ];
    const state = createClassicDraft(
      {
        draftId: 'draft-era',
        variant: 'ratings',
        seed: seedFromString('era-keep'),
        dataVersion: 'data-v1',
        catalog,
      },
      context,
    );
    const narrowed = { ...state, roll: { franchiseId: 'lakers', eraId: '1990s' } };
    const before = narrowed.roll;
    const rolled = rerollClassicFranchise(narrowed, catalog, context);
    expect(rolled.roll?.franchiseId).not.toBe(before.franchiseId);
    expect(rolled.roll?.eraId).toBe(before.eraId);
    expect(rolled.rerolls.franchiseSpent).toBe(true);
    expect(rolled.rerolls.franchiseRound).toBe(1);
    expect(rolled.round).toBe(1);
    expect(rolled.picks).toEqual(narrowed.picks);
    expect(() => rerollClassicFranchise(rolled, catalog, context)).toThrow(/already spent/);
  });

  it('era reroll changes the era, preserves the franchise, and spends once', () => {
    const catalog: ClassicDraftCatalog = [
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        players: [
          { playerId: 'p-1', positions: ['PG'] },
          { playerId: 'p-2', positions: ['PG', 'SF'] },
          { playerId: 'p-3', positions: ['SF'] },
          { playerId: 'p-5', positions: ['C'] },
        ],
      },
      {
        franchiseId: 'lakers',
        eraId: '1980s',
        players: [{ playerId: 'p-6', positions: ['SF'] }],
      },
      {
        franchiseId: 'lakers',
        eraId: '2010s',
        players: [{ playerId: 'p-9', positions: ['SG'] }],
      },
    ];
    const state = createClassicDraft(
      {
        draftId: 'draft-franchise',
        variant: 'ratings',
        seed: seedFromString('franchise-keep'),
        dataVersion: 'data-v1',
        catalog,
      },
      context,
    );
    const narrowed = { ...state, roll: { franchiseId: 'lakers', eraId: '1990s' } };
    const before = narrowed.roll;
    const rolled = rerollClassicEra(narrowed, catalog, context);
    expect(rolled.roll?.eraId).not.toBe(before.eraId);
    expect(rolled.roll?.franchiseId).toBe(before.franchiseId);
    expect(rolled.rerolls.eraSpent).toBe(true);
    expect(rolled.rerolls.eraRound).toBe(1);
    expect(() => rerollClassicEra(rolled, catalog, context)).toThrow(/already spent/);
  });

  it('franchise and era rerolls are independent in either order', () => {
    const catalog = catalogFixture();
    const bothFranchiseFirst = rerollClassicEra(
      rerollClassicFranchise(draftFixture(), catalog, context),
      catalog,
      context,
    );
    expect(bothFranchiseFirst.rerolls.franchiseSpent).toBe(true);
    expect(bothFranchiseFirst.rerolls.eraSpent).toBe(true);
    const bothEraFirst = rerollClassicFranchise(
      rerollClassicEra(draftFixture(), catalog, context),
      catalog,
      context,
    );
    expect(bothEraFirst.rerolls.franchiseSpent).toBe(true);
    expect(bothEraFirst.rerolls.eraSpent).toBe(true);
  });

  it('availability tracks spending and alternatives', () => {
    const catalog = catalogFixture();
    const state = draftFixture();
    expect(classicRerollAvailable(state, 'franchise', catalog)).toBe(true);
    expect(classicRerollAvailable(state, 'era', catalog)).toBe(true);
    const franchiseSpent = rerollClassicFranchise(state, catalog, context);
    expect(classicRerollAvailable(franchiseSpent, 'franchise', catalog)).toBe(false);
    expect(classicRerollAvailable(franchiseSpent, 'era', catalog)).toBe(true);
    const bothSpent = rerollClassicEra(franchiseSpent, catalog, context);
    expect(classicRerollAvailable(bothSpent, 'era', catalog)).toBe(false);
  });

  it('rejects a reroll with no alternative without spending it', () => {
    const catalog: ClassicDraftCatalog = [
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        players: [
          { playerId: 'p-1', positions: ['PG'] },
          { playerId: 'p-2', positions: ['PG', 'SF'] },
          { playerId: 'p-3', positions: ['SF'] },
          { playerId: 'p-5', positions: ['C'] },
        ],
      },
      { franchiseId: 'celtics', eraId: '1990s', players: [{ playerId: 'p-4', positions: ['PG'] }] },
    ];
    const state = createClassicDraft(
      {
        draftId: 'draft-tight',
        variant: 'ratings',
        seed: seedFromString('tight'),
        dataVersion: 'data-v1',
        catalog,
      },
      context,
    );
    const narrowed: ClassicDraftState = {
      ...state,
      roll: { franchiseId: 'lakers', eraId: '1990s' },
      round: 5,
      status: 'drafting',
      picks: [
        { round: 1, playerId: 'p-1', franchiseId: 'lakers', eraId: '1990s', slotIndex: 0 },
        { round: 2, playerId: 'p-4', franchiseId: 'celtics', eraId: '1990s', slotIndex: 1 },
        { round: 3, playerId: 'p-2', franchiseId: 'lakers', eraId: '1990s', slotIndex: 2 },
        { round: 4, playerId: 'p-3', franchiseId: 'lakers', eraId: '1990s', slotIndex: 3 },
      ],
    };

    expect(() => rerollClassicFranchise(narrowed, catalog, context)).toThrow(
      /no alternative franchise for era 1990s in round 5/,
    );
    expect(() => rerollClassicEra(narrowed, catalog, context)).toThrow(
      /no alternative era for franchise lakers in round 5/,
    );
    expect(narrowed.rerolls).toEqual({ franchiseSpent: false, eraSpent: false });
    expect(narrowed.roll).toEqual({ franchiseId: 'lakers', eraId: '1990s' });
  });

  it('can still complete a round when only the C slot is open', () => {
    const catalog: ClassicDraftCatalog = [
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        players: [
          { playerId: 'p-1', positions: ['PG'] },
          { playerId: 'p-2', positions: ['PG', 'SF'] },
          { playerId: 'p-3', positions: ['SF'] },
          { playerId: 'p-5', positions: ['C'] },
        ],
      },
      { franchiseId: 'celtics', eraId: '1990s', players: [{ playerId: 'p-4', positions: ['PG'] }] },
    ];
    const state = createClassicDraft(
      {
        draftId: 'draft-tight',
        variant: 'ratings',
        seed: seedFromString('tight'),
        dataVersion: 'data-v1',
        catalog,
      },
      context,
    );
    const narrowed: ClassicDraftState = {
      ...state,
      roll: { franchiseId: 'lakers', eraId: '1990s' },
      round: 5,
      status: 'drafting',
      picks: [
        { round: 1, playerId: 'p-1', franchiseId: 'lakers', eraId: '1990s', slotIndex: 0 },
        { round: 2, playerId: 'p-4', franchiseId: 'celtics', eraId: '1990s', slotIndex: 1 },
        { round: 3, playerId: 'p-2', franchiseId: 'lakers', eraId: '1990s', slotIndex: 2 },
        { round: 4, playerId: 'p-3', franchiseId: 'lakers', eraId: '1990s', slotIndex: 3 },
      ],
    };
    const done = draftClassicPlayer(narrowed, catalog, { playerId: 'p-5', slotIndex: 4 }, context);
    expect(done.status).toBe('complete');
    expect(done.picks).toHaveLength(5);
  });
});

describe('classic reroll single-axis candidates', () => {
  it('franchise reroll preserves the era and changes the franchise across seeds', () => {
    const catalog = decoyFixture();
    for (let i = 0; i < 20; i += 1) {
      const state = decoyState({ seed: seedFromString(`decoy-franchise-${String(i)}`) });
      const rolled = rerollClassicFranchise(state, catalog, context);
      expect(rolled.roll?.eraId).toBe('1990s');
      expect(rolled.roll?.franchiseId).not.toBe('lakers');
    }
  });

  it('era reroll preserves the franchise and changes the era across seeds', () => {
    const catalog = decoyFixture();
    for (let i = 0; i < 20; i += 1) {
      const state = decoyState({ seed: seedFromString(`decoy-era-${String(i)}`) });
      const rolled = rerollClassicEra(state, catalog, context);
      expect(rolled.roll?.franchiseId).toBe('lakers');
      expect(rolled.roll?.eraId).not.toBe('1990s');
    }
  });

  it('excludes pairs that change both axes from either reroll', () => {
    const state = decoyState();
    const franchiseCandidates = classicRollCandidates(decoyFixture(), state, 'franchise-reroll');
    const eraCandidates = classicRollCandidates(decoyFixture(), state, 'era-reroll');
    const franchiseKeys = new Set(
      franchiseCandidates.map((entry) => `${entry.franchiseId}/${entry.eraId}`),
    );
    const eraKeys = new Set(eraCandidates.map((entry) => `${entry.franchiseId}/${entry.eraId}`));
    for (const entry of franchiseCandidates) {
      expect(entry.eraId).toBe('1990s');
      expect(entry.franchiseId).not.toBe('lakers');
    }
    for (const entry of eraCandidates) {
      expect(entry.franchiseId).toBe('lakers');
      expect(entry.eraId).not.toBe('1990s');
    }
    for (const key of ['heat/2000s', 'knicks/2010s', 'spurs/1980s']) {
      expect(franchiseKeys.has(key)).toBe(false);
      expect(eraKeys.has(key)).toBe(false);
    }
    expect(franchiseKeys).toEqual(new Set(['bulls/1990s', 'celtics/1990s']));
    expect(eraKeys).toEqual(new Set(['lakers/1980s', 'lakers/2000s']));
  });

  it('drops same-axis entries whose only player is already drafted', () => {
    const franchiseState = decoyState({
      picks: [
        {
          round: 1,
          playerId: 'decoy-celtics-1990s',
          franchiseId: 'celtics',
          eraId: '1990s',
          slotIndex: 0,
        },
      ],
    });
    const franchiseKeys = new Set(
      classicRollCandidates(decoyFixture(), franchiseState, 'franchise-reroll').map(
        (entry) => `${entry.franchiseId}/${entry.eraId}`,
      ),
    );
    expect(franchiseKeys.has('celtics/1990s')).toBe(false);
    expect(franchiseKeys.has('bulls/1990s')).toBe(true);

    const eraState = decoyState({
      picks: [
        {
          round: 1,
          playerId: 'decoy-lakers-1980s',
          franchiseId: 'lakers',
          eraId: '1980s',
          slotIndex: 0,
        },
      ],
    });
    const eraKeys = new Set(
      classicRollCandidates(decoyFixture(), eraState, 'era-reroll').map(
        (entry) => `${entry.franchiseId}/${entry.eraId}`,
      ),
    );
    expect(eraKeys.has('lakers/1980s')).toBe(false);
    expect(eraKeys.has('lakers/2000s')).toBe(true);
  });

  it('franchise reroll spends only its token and leaves the era reroll usable', () => {
    const catalog = decoyFixture();
    const rolled = rerollClassicFranchise(decoyState(), catalog, context);
    expect(rolled.rerolls).toEqual({
      franchiseSpent: true,
      franchiseRound: 1,
      eraSpent: false,
    });
    expect(() => rerollClassicFranchise(rolled, catalog, context)).toThrow(/already spent/);
    const eraAfter = rerollClassicEra(rolled, catalog, context);
    expect(eraAfter.rerolls.eraSpent).toBe(true);
    expect(eraAfter.roll?.franchiseId).toBe(rolled.roll?.franchiseId);
    expect(eraAfter.roll?.eraId).not.toBe('1990s');
  });

  it('era reroll spends only its token and leaves the franchise reroll usable', () => {
    const catalog = decoyFixture();
    const rolled = rerollClassicEra(decoyState(), catalog, context);
    expect(rolled.rerolls).toEqual({
      franchiseSpent: false,
      eraSpent: true,
      eraRound: 1,
    });
    expect(() => rerollClassicEra(rolled, catalog, context)).toThrow(/already spent/);
    const franchiseAfter = rerollClassicFranchise(rolled, catalog, context);
    expect(franchiseAfter.rerolls.franchiseSpent).toBe(true);
    expect(franchiseAfter.roll?.eraId).toBe(rolled.roll?.eraId);
    expect(franchiseAfter.roll?.franchiseId).not.toBe('lakers');
  });

  it('rejects an axis reroll with no alternative on that axis without spending', () => {
    const catalog: ClassicDraftCatalog = [
      {
        franchiseId: 'knicks',
        eraId: '2010s',
        players: [{ playerId: 'decoy-knicks-2010s', positions: ['PG', 'SF', 'C'] }],
      },
      {
        franchiseId: 'heat',
        eraId: '2000s',
        players: [{ playerId: 'decoy-heat-2000s', positions: ['PG', 'SF', 'C'] }],
      },
    ];
    const state = decoyState({ roll: { franchiseId: 'knicks', eraId: '2010s' } });
    expect(classicRerollAvailable(state, 'franchise', catalog)).toBe(false);
    expect(classicRerollAvailable(state, 'era', catalog)).toBe(false);
    expect(() => rerollClassicFranchise(state, catalog, context)).toThrow(
      /no alternative franchise for era 2010s in round 1/,
    );
    expect(() => rerollClassicEra(state, catalog, context)).toThrow(
      /no alternative era for franchise knicks in round 1/,
    );
    expect(state.rerolls).toEqual({ franchiseSpent: false, eraSpent: false });
    expect(state.roll).toEqual({ franchiseId: 'knicks', eraId: '2010s' });
  });

  it('reroll candidates respect the open slots of the current round', () => {
    const state = decoyState({
      round: 5,
      picks: [
        {
          round: 1,
          playerId: 'decoy-lakers-1990s',
          franchiseId: 'lakers',
          eraId: '1990s',
          slotIndex: 0,
        },
        {
          round: 2,
          playerId: 'decoy-bulls-1990s',
          franchiseId: 'bulls',
          eraId: '1990s',
          slotIndex: 1,
        },
        {
          round: 3,
          playerId: 'decoy-celtics-1990s',
          franchiseId: 'celtics',
          eraId: '1990s',
          slotIndex: 2,
        },
        {
          round: 4,
          playerId: 'decoy-lakers-1980s',
          franchiseId: 'lakers',
          eraId: '1980s',
          slotIndex: 3,
        },
      ],
    });

    const franchiseCandidates = classicRollCandidates(decoyFixture(), state, 'franchise-reroll');
    expect(franchiseCandidates).toEqual([]);
    expect(classicRerollAvailable(state, 'franchise', decoyFixture())).toBe(false);
    expect(() => rerollClassicFranchise(state, decoyFixture(), context)).toThrow(
      /no alternative franchise/,
    );

    const eraCandidates = classicRollCandidates(decoyFixture(), state, 'era-reroll');
    expect(eraCandidates.map((entry) => `${entry.franchiseId}/${entry.eraId}`)).toEqual([
      'lakers/2000s',
    ]);
    const rolled = rerollClassicEra(state, decoyFixture(), context);
    expect(rolled.roll).toEqual({ franchiseId: 'lakers', eraId: '2000s' });
    expect(rolled.rerolls.eraSpent).toBe(true);
    expect(rolled.rerolls.franchiseSpent).toBe(false);
  });
});

describe('classic candidate filtering and picks', () => {
  it('excludes entries whose remaining players cannot fill any open slot', () => {
    const state: ClassicDraftState = {
      ...draftFixture(),
      round: 5,
      status: 'drafting',
      roll: { franchiseId: 'lakers', eraId: '1990s' },
      picks: [
        { round: 1, playerId: 'p-1', franchiseId: 'lakers', eraId: '1990s', slotIndex: 0 },
        { round: 2, playerId: 'p-4', franchiseId: 'celtics', eraId: '1990s', slotIndex: 1 },
        { round: 3, playerId: 'p-6', franchiseId: 'lakers', eraId: '1980s', slotIndex: 2 },
        { round: 4, playerId: 'p-2', franchiseId: 'lakers', eraId: '1990s', slotIndex: 3 },
      ],
    };
    const candidates = classicRollCandidates(catalogFixture(), state, 'initial');
    const keys = new Set(candidates.map((e) => `${e.franchiseId}/${e.eraId}`));

    expect(keys.has('bulls/1990s')).toBe(false);
    expect(keys.has('lakers/2010s')).toBe(false);
    expect(keys.has('bulls/2010s')).toBe(false);
    expect(keys.has('lakers/1990s')).toBe(true);
    expect(keys.has('celtics/2010s')).toBe(true);
    expect(keys.has('heat/2000s')).toBe(true);
  });

  it('rejects a player into a slot their positions cannot fill', () => {
    const base = { ...draftFixture(), roll: { franchiseId: 'lakers', eraId: '1990s' } };
    expect(() =>
      draftClassicPlayer(base, catalogFixture(), { playerId: 'p-1', slotIndex: 4 }, context),
    ).toThrow(/p-1 cannot play slot 4/);
    expect(() =>
      draftClassicPlayer(base, catalogFixture(), { playerId: 'p-3', slotIndex: 0 }, context),
    ).toThrow(/p-3 cannot play slot 0/);
  });

  it('rejects duplicate players, occupied slots, and unknown players', () => {
    const base = { ...draftFixture(), roll: { franchiseId: 'lakers', eraId: '1990s' } };
    const one = draftClassicPlayer(
      base,
      catalogFixture(),
      { playerId: 'p-1', slotIndex: 0 },
      context,
    );
    expect(() =>
      draftClassicPlayer(one, catalogFixture(), { playerId: 'p-1', slotIndex: 1 }, context),
    ).toThrow(/p-1 is already drafted/);
    const displacementDraft = {
      ...draftFixture(),
      roll: { franchiseId: 'lakers', eraId: '1990s' },
      picks: [{ round: 1, playerId: 'p-1', franchiseId: 'lakers', eraId: '1990s', slotIndex: 0 }],
      round: 2,
    };
    const displaced = draftClassicPlayer(
      displacementDraft,
      catalogFixture(),
      { playerId: 'p-2', slotIndex: 0 },
      context,
    );
    expect(displaced.picks.find((p) => p.playerId === 'p-2')?.slotIndex).toBe(0);
    expect(displaced.picks.find((p) => p.playerId === 'p-1')?.slotIndex).toBe(1);
    const twoCenters: ClassicDraftCatalog = catalogFixture().map((entry) =>
      entry.franchiseId === 'celtics' && entry.eraId === '1990s'
        ? {
            ...entry,
            players: [
              { playerId: 'p-4', positions: ['PG'] },
              { playerId: 'p-5', positions: ['C'] },
              { playerId: 'p-10', positions: ['C'] },
            ],
          }
        : entry,
    );
    const centerOnly = {
      ...draftFixture(),
      roll: { franchiseId: 'celtics', eraId: '1990s' },
      picks: [{ round: 1, playerId: 'p-5', franchiseId: 'celtics', eraId: '1990s', slotIndex: 4 }],
      round: 2,
    };
    expect(() =>
      draftClassicPlayer(centerOnly, twoCenters, { playerId: 'p-10', slotIndex: 4 }, context),
    ).toThrow(/slot 4 is already filled/);
    expect(() =>
      draftClassicPlayer(base, catalogFixture(), { playerId: 'p-404', slotIndex: 0 }, context),
    ).toThrow(/p-404 is not in the rolled pool/);
  });

  it('rejects a draft whose catalog lacks the current roll pair', () => {
    const base = { ...draftFixture(), roll: { franchiseId: 'spurs', eraId: '1990s' } };
    expect(() =>
      draftClassicPlayer(base, catalogFixture(), { playerId: 'p-1', slotIndex: 0 }, context),
    ).toThrow(/catalog does not contain the current roll pair/);
  });
});

describe('classic repositioning', () => {
  it('moves a drafted player to an open legal slot', () => {
    const base = { ...draftFixture(), roll: { franchiseId: 'lakers', eraId: '1990s' } };
    const state = draftClassicPlayer(
      base,
      catalogFixture(),
      { playerId: 'p-1', slotIndex: 0 },
      context,
    );
    const moved = repositionClassicPlayer(state, catalogFixture(), {
      playerId: 'p-1',
      slotIndex: 1,
    });
    expect(moved.picks[0]?.slotIndex).toBe(1);
    expect(moved.picks).toHaveLength(1);
    expect(moved.round).toBe(state.round);
    expect(moved.status).toBe(state.status);
  });

  it('swaps two picks when both destinations are legal', () => {
    const base = { ...draftFixture(), roll: { franchiseId: 'lakers', eraId: '1990s' } };
    const one = draftClassicPlayer(
      base,
      catalogFixture(),
      { playerId: 'p-1', slotIndex: 0 },
      context,
    );
    const two = draftClassicPlayer(
      { ...one, roll: { franchiseId: 'lakers', eraId: '1990s' } },
      catalogFixture(),
      { playerId: 'p-2', slotIndex: 1 },
      context,
    );
    const swapped = repositionClassicPlayer(two, catalogFixture(), {
      playerId: 'p-1',
      slotIndex: 1,
    });
    expect(swapped.picks.find((p) => p.playerId === 'p-1')?.slotIndex).toBe(1);
    expect(swapped.picks.find((p) => p.playerId === 'p-2')?.slotIndex).toBe(0);
  });

  it('displaces the incumbent when a swap is not legal', () => {
    const state = {
      ...draftFixture(),
      roll: { franchiseId: 'lakers', eraId: '1990s' },
      picks: [
        { round: 1, playerId: 'p-1', franchiseId: 'lakers', eraId: '1990s', slotIndex: 0 },
        { round: 2, playerId: 'p-2', franchiseId: 'lakers', eraId: '1990s', slotIndex: 3 },
      ],
      round: 3,
    };
    const moved = repositionClassicPlayer(state, catalogFixture(), {
      playerId: 'p-2',
      slotIndex: 0,
    });
    expect(moved.picks.find((p) => p.playerId === 'p-2')?.slotIndex).toBe(0);
    expect(moved.picks.find((p) => p.playerId === 'p-1')?.slotIndex).toBe(1);
  });

  it('drafts into an occupied slot by displacing the incumbent', () => {
    const state = {
      ...draftFixture(),
      roll: { franchiseId: 'heat', eraId: '2000s' },
      picks: [{ round: 1, playerId: 'p-8', franchiseId: 'heat', eraId: '2000s', slotIndex: 4 }],
      round: 2,
    };
    const catalog: ClassicDraftCatalog = catalogFixture().map((entry) =>
      entry.franchiseId === 'heat' && entry.eraId === '2000s'
        ? {
            ...entry,
            players: [
              { playerId: 'p-8', positions: ['PF', 'C'] },
              { playerId: 'p-12', positions: ['C'] },
            ],
          }
        : entry,
    );
    const next = draftClassicPlayer(state, catalog, { playerId: 'p-12', slotIndex: 4 }, context);
    expect(next.picks.find((p) => p.playerId === 'p-12')?.slotIndex).toBe(4);
    expect(next.picks.find((p) => p.playerId === 'p-8')?.slotIndex).toBe(2);
  });

  it('rejects illegal targets, unknown players, and stuck swaps', () => {
    const base = { ...draftFixture(), roll: { franchiseId: 'lakers', eraId: '1990s' } };
    const one = draftClassicPlayer(
      base,
      catalogFixture(),
      { playerId: 'p-1', slotIndex: 0 },
      context,
    );
    const two = draftClassicPlayer(
      { ...one, roll: { franchiseId: 'lakers', eraId: '1990s' } },
      catalogFixture(),
      { playerId: 'p-3', slotIndex: 4 },
      context,
    );

    expect(() =>
      repositionClassicPlayer(two, catalogFixture(), { playerId: 'p-1', slotIndex: 4 }),
    ).toThrow(/p-1 cannot play slot 4/);

    expect(() =>
      repositionClassicPlayer(two, catalogFixture(), { playerId: 'p-3', slotIndex: 0 }),
    ).toThrow(/p-3 cannot play slot 0/);

    expect(() =>
      repositionClassicPlayer(two, catalogFixture(), { playerId: 'p-404', slotIndex: 2 }),
    ).toThrow(/p-404 is not drafted/);

    const unchanged = repositionClassicPlayer(two, catalogFixture(), {
      playerId: 'p-1',
      slotIndex: 0,
    });
    expect(unchanged).toBe(two);
  });

  it('never changes round, status, roll, or rerolls', () => {
    const base = { ...draftFixture(), roll: { franchiseId: 'lakers', eraId: '1990s' } };
    const one = draftClassicPlayer(
      base,
      catalogFixture(),
      { playerId: 'p-1', slotIndex: 0 },
      context,
    );
    const moved = repositionClassicPlayer(one, catalogFixture(), { playerId: 'p-1', slotIndex: 1 });
    expect(moved.round).toBe(one.round);
    expect(moved.status).toBe(one.status);
    expect(moved.roll).toEqual(one.roll);
    expect(moved.rerolls).toEqual(one.rerolls);
  });
});

describe('createClassicChallenge', () => {
  it('creates an accepted classic run from a complete draft', () => {
    const done = draftFive(draftFixture());
    const creation = createClassicChallenge(done, challengeEnvironment(done));
    expect(creation.mode).toBe('classic');
    expect(creation.franchiseId).toBeNull();
    expect(creation.variant).toBe('ratings');
    expect(creation.classicDraft.picks).toHaveLength(5);
    expect(creation.classicDraft.draftId).toBe(done.draftId);
    expect(creation.classicDraft.seed).toBe(done.seed);
    const run = createChallenge(creation);
    expect(challengeRunSchema.safeParse(run).success).toBe(true);
    expect(run.mode).toBe('classic');
    expect(run.variant).toBe('ratings');
    expect(run.classicDraft?.picks).toHaveLength(5);
    expect(run.franchiseId).toBeNull();
  });

  it('rejects an incomplete draft', () => {
    const state = draftFixture();
    expect(() => createClassicChallenge(state, challengeEnvironment(state))).toThrow(
      /requires a complete draft/,
    );
  });

  it('rejects duplicate playerIds in the picks', () => {
    const state = completeFixture({
      picks: [
        { round: 1, playerId: 'p-1', franchiseId: 'lakers', eraId: '1990s', slotIndex: 0 },
        { round: 2, playerId: 'p-1', franchiseId: 'lakers', eraId: '1990s', slotIndex: 1 },
        { round: 3, playerId: 'p-6', franchiseId: 'lakers', eraId: '1980s', slotIndex: 2 },
        { round: 4, playerId: 'p-11', franchiseId: 'bulls', eraId: '2010s', slotIndex: 3 },
        { round: 5, playerId: 'p-3', franchiseId: 'lakers', eraId: '1990s', slotIndex: 4 },
      ],
    });
    expect(() => createClassicChallenge(state, challengeEnvironment(state))).toThrow(
      /distinct players/,
    );
  });

  it('rejects slot/player mismatches with the resolved players', () => {
    const done = draftFive(draftFixture());
    const env = challengeEnvironment(done, {
      players: challengeEnvironment(done).players.map((player, slotIndex) =>
        slotIndex === 0 ? { ...player, playerId: 'p-999' } : player,
      ),
    });
    expect(() => createClassicChallenge(done, env)).toThrow(/does not match the draft pick/);
  });

  it('rejects an illegal lineup built from the picks', () => {
    const state = completeFixture({
      picks: [
        { round: 1, playerId: 'p-1', franchiseId: 'lakers', eraId: '1990s', slotIndex: 0 },
        { round: 2, playerId: 'p-4', franchiseId: 'celtics', eraId: '1990s', slotIndex: 1 },
        { round: 3, playerId: 'p-6', franchiseId: 'lakers', eraId: '1980s', slotIndex: 2 },
        { round: 4, playerId: 'p-11', franchiseId: 'bulls', eraId: '2010s', slotIndex: 3 },

        { round: 5, playerId: 'p-7', franchiseId: 'bulls', eraId: '1990s', slotIndex: 4 },
      ],
    });
    expect(() => createClassicChallenge(state, challengeEnvironment(state))).toThrow(
      /classic lineup is not legal/,
    );
  });
});

describe('classic draft command sequences (property)', () => {
  const commandArb = fc.constantFrom<'pick' | 'reposition' | 'franchise-reroll' | 'era-reroll'>(
    'pick',
    'reposition',
    'franchise-reroll',
    'era-reroll',
  );

  it('preserves draft invariants through any bounded command sequence', () => {
    fc.assert(
      fc.property(fc.array(commandArb, { maxLength: 30 }), (commands) => {
        const catalog = catalogFixture();
        let state = draftFixture();
        for (const command of commands) {
          if (state.status === 'complete') break;
          if (state.roll === null) break;
          const entry = entryOf(catalog, state.roll.franchiseId, state.roll.eraId);
          switch (command) {
            case 'franchise-reroll': {
              if (!classicRerollAvailable(state, 'franchise', catalog)) break;
              const before = state.roll;
              state = rerollClassicFranchise(state, catalog, context);
              expect(state.rerolls.franchiseSpent).toBe(true);
              expect(state.rerolls.franchiseRound).toBe(state.round);
              expect(state.roll?.franchiseId).not.toBe(before.franchiseId);
              expect(state.roll?.eraId).toBe(before.eraId);
              break;
            }
            case 'era-reroll': {
              if (!classicRerollAvailable(state, 'era', catalog)) break;
              const before = state.roll;
              state = rerollClassicEra(state, catalog, context);
              expect(state.rerolls.eraSpent).toBe(true);
              expect(state.rerolls.eraRound).toBe(state.round);
              expect(state.roll?.eraId).not.toBe(before.eraId);
              expect(state.roll?.franchiseId).toBe(before.franchiseId);
              break;
            }
            case 'pick': {
              const occupied = new Set(state.picks.map((p) => p.slotIndex));
              const drafted = new Set(state.picks.map((p) => p.playerId));
              const slotIndex = [0, 1, 2, 3, 4].find(
                (s) =>
                  !occupied.has(s) &&
                  entry.players.some(
                    (p) => !drafted.has(p.playerId) && canPlay(p.positions, slotRequirement(s)),
                  ),
              );
              if (slotIndex === undefined) break;
              const player = entry.players.find(
                (p) => !drafted.has(p.playerId) && canPlay(p.positions, slotRequirement(slotIndex)),
              );
              if (!player) break;
              state = draftClassicPlayer(
                state,
                catalog,
                { playerId: player.playerId, slotIndex: slotIndex },
                context,
              );
              break;
            }
            case 'reposition': {
              const pick = state.picks[0];
              if (!pick) break;
              const pickEntry = entryOf(catalog, pick.franchiseId, pick.eraId);
              const player = pickEntry.players.find((p) => p.playerId === pick.playerId);
              if (!player) break;
              const target = [0, 1, 2, 3, 4].find(
                (s) => s !== pick.slotIndex && canPlay(player.positions, slotRequirement(s)),
              );
              if (target === undefined) break;
              const incumbent = state.picks.find((p) => p.slotIndex === target);
              if (incumbent) {
                const incumbentEntry = entryOf(catalog, incumbent.franchiseId, incumbent.eraId);
                const incumbentPlayer = incumbentEntry.players.find(
                  (p) => p.playerId === incumbent.playerId,
                );
                if (
                  !incumbentPlayer ||
                  !canPlay(incumbentPlayer.positions, slotRequirement(pick.slotIndex))
                ) {
                  break;
                }
              }
              state = repositionClassicPlayer(state, catalog, {
                playerId: pick.playerId,
                slotIndex: target,
              });
              break;
            }
          }
        }
        expect(new Set(state.picks.map((p) => p.playerId)).size).toBe(state.picks.length);
        expect(new Set(state.picks.map((p) => p.slotIndex)).size).toBe(state.picks.length);
        expect(state.picks.length).toBeLessThanOrEqual(5);
        expect(state.round).toBeGreaterThanOrEqual(1);
        expect(state.round).toBeLessThanOrEqual(5);
        expect(state.status === 'complete' ? state.roll === null : state.roll !== null).toBe(true);
        if (state.picks.length === 5) {
          expect(state.status).toBe('complete');
        }
        for (const pick of state.picks) {
          const pickEntry = entryOf(catalog, pick.franchiseId, pick.eraId);
          const pickPlayer = pickEntry.players.find((p) => p.playerId === pick.playerId);
          expect(canPlay(pickPlayer?.positions ?? [], slotRequirement(pick.slotIndex))).toBe(true);
        }
      }),
      { numRuns: 50 },
    );
  });
});
