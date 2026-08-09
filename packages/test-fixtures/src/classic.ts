import type {
  ClassicCatalogEntry,
  ClassicCompletedDraft,
  ClassicDraftCatalog,
  ClassicDraftState,
  ClassicPick,
} from '@hoop-rush/data-contracts';

/**
 * Classic mode fixtures (M4). Deterministic builders for the Classic draft
 * contracts in packages/data-contracts/src/classic.ts: a mini franchise-era
 * catalog, picks, drafting/completed draft states, and the completed snapshot
 * persisted on classic runs. Builders follow the repo shallow-override
 * pattern (buildX(overrides) spreads overrides last) and always return
 * schema-valid records so downstream persistence and web tests can rely on
 * the shapes without parsing.
 */

/** Fixed seed used by every classic fixture; 32 hex chars (seedSchema range). */
const FIXTURE_CLASSIC_SEED = 'abc123abc123abc123abc123abc123ab' as const;

const DEFAULT_CLASSIC_CATALOG: readonly ClassicCatalogEntry[] = [
  {
    franchiseId: 'lakers',
    eraId: '1990s',
    players: [
      { playerId: 'p-lal-g', positions: ['PG', 'SG'] },
      { playerId: 'p-lal-gf', positions: ['PG', 'SF'] },
      { playerId: 'p-lal-c', positions: ['C'] },
    ],
  },
  {
    franchiseId: 'lakers',
    eraId: '1980s',
    players: [{ playerId: 'p-lal-f', positions: ['SF', 'PF'] }],
  },
  {
    franchiseId: 'celtics',
    eraId: '1990s',
    players: [
      { playerId: 'p-bos-g', positions: ['PG', 'SG'] },
      { playerId: 'p-bos-c', positions: ['C'] },
    ],
  },
  {
    franchiseId: 'celtics',
    eraId: '1980s',
    players: [{ playerId: 'p-bos-c2', positions: ['C'] }],
  },
  {
    franchiseId: 'bulls',
    eraId: '1990s',
    players: [
      { playerId: 'p-chi-f', positions: ['SF', 'PF'] },
      { playerId: 'p-chi-c', positions: ['C'] },
    ],
  },
  {
    franchiseId: 'bulls',
    eraId: '1980s',
    players: [{ playerId: 'p-chi-g', positions: ['PG', 'SG'] }],
  },
  {
    franchiseId: 'heat',
    eraId: '2000s',
    players: [
      { playerId: 'p-mia-fc', positions: ['PF', 'C'] },
      { playerId: 'p-mia-g', positions: ['PG', 'SG'] },
    ],
  },
  {
    franchiseId: 'knicks',
    eraId: '2010s',
    players: [
      { playerId: 'p-nyk-f', positions: ['SF', 'PF'] },
      { playerId: 'p-nyk-c', positions: ['C'] },
    ],
  },
];

/**
 * A deterministic mini-catalog: 8 entries across 5 franchises and 5 eras,
 * every player with the sorted detailed playable union. Pass `entries` to
 * replace the whole catalog (the array type has no meaningful partial).
 */
export function buildClassicCatalog(
  entries: readonly ClassicCatalogEntry[] = DEFAULT_CLASSIC_CATALOG,
): ClassicDraftCatalog {
  return entries.map((entry) => ({
    franchiseId: entry.franchiseId,
    eraId: entry.eraId,
    players: entry.players.map((player) => ({
      playerId: player.playerId,
      positions: [...player.positions],
    })),
  }));
}

export function buildClassicPick(overrides: Partial<ClassicPick> = {}): ClassicPick {
  return {
    round: 1,
    playerId: 'p-lal-g',
    franchiseId: 'lakers',
    eraId: '1990s',
    slotIndex: 0,
    ...overrides,
  };
}

/** A drafting draft: round 1, an active Lakers-1990s roll, fresh rerolls, no picks. */
export function buildClassicDraftState(
  overrides: Partial<ClassicDraftState> = {},
): ClassicDraftState {
  return {
    schemaVersion: 1,
    draftId: 'draft-1',
    variant: 'ratings',
    seed: FIXTURE_CLASSIC_SEED,
    dataVersion: 'data-v1',
    round: 1,
    status: 'drafting',
    roll: { franchiseId: 'lakers', eraId: '1990s' },
    rerolls: { franchiseSpent: false, eraSpent: false },
    picks: [],
    ...overrides,
  };
}

/**
 * A completed draft snapshot with five distinct picks in rounds 1-5 and a
 * legal G,G,F,F,C slot assignment: p-lal-g@0, p-bos-g@1, p-lal-f@2,
 * p-chi-f@3, p-lal-c@4. Every picked playerId exists in the default catalog.
 */
export function buildClassicCompletedDraft(
  overrides: Partial<ClassicCompletedDraft> = {},
): ClassicCompletedDraft {
  const picks: ClassicPick[] = [
    buildClassicPick({ round: 1, playerId: 'p-lal-g', franchiseId: 'lakers', eraId: '1990s' }),
    buildClassicPick({
      round: 2,
      playerId: 'p-bos-g',
      franchiseId: 'celtics',
      eraId: '1990s',
      slotIndex: 1,
    }),
    buildClassicPick({
      round: 3,
      playerId: 'p-lal-f',
      franchiseId: 'lakers',
      eraId: '1980s',
      slotIndex: 2,
    }),
    buildClassicPick({
      round: 4,
      playerId: 'p-chi-f',
      franchiseId: 'bulls',
      eraId: '1990s',
      slotIndex: 3,
    }),
    buildClassicPick({
      round: 5,
      playerId: 'p-lal-c',
      franchiseId: 'lakers',
      eraId: '1990s',
      slotIndex: 4,
    }),
  ];
  return {
    draftId: 'draft-1',
    variant: 'ratings',
    seed: FIXTURE_CLASSIC_SEED,
    picks,
    ...overrides,
  };
}

/** The full draft state of a completed draft: 5 picks, complete, rerolls spent, roll null. */
export function buildCompletedDraftState(
  overrides: Partial<ClassicDraftState> = {},
): ClassicDraftState {
  const completed = buildClassicCompletedDraft();
  return buildClassicDraftState({
    draftId: completed.draftId,
    variant: completed.variant,
    seed: completed.seed,
    round: 5,
    status: 'complete',
    roll: null,
    rerolls: { franchiseSpent: true, franchiseRound: 5, eraSpent: true, eraRound: 5 },
    picks: completed.picks,
    ...overrides,
  });
}
