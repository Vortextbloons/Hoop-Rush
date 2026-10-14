import { describe, expect, it } from 'vitest';
import type {
  DraftDuelCard,
  DraftDuelCatalogEntry,
  DraftDuelCommand,
  DraftDuelDraft,
  DraftDuelOfferedPick,
  DraftDuelParticipantId,
  DraftDuelPick,
  DraftDuelRoster,
  DraftDuelRound,
  GameResult,
  PlayerBoxScore,
  Position,
  Seed,
  TeamResult,
} from '@hoop-rush/data-contracts';
import {
  DRAFT_DUEL_MAX_GENERATION_ATTEMPTS,
  LINEUP_STRUCTURE,
  OVERALL_BANDS,
  SHOT_ZONES,
  contentHashSchema,
  draftDuelCatalogEntrySchema,
  draftDuelCommandSchema,
  draftDuelDraftSchema,
  gameResultSchema,
  playerIdSchema,
  seedFromString,
  seedSchema,
  slotGroupOf,
  teamResultSchema,
} from '@hoop-rush/data-contracts';
import { seasonDigestHex } from '@hoop-rush/data-contracts';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { createRng, shuffle } from '../../sim/rng.ts';
import { cardPlayableAt, buildDraftDuelCatalog } from './catalog.ts';
import type { DraftDuelCatalog } from './catalog.ts';
import {
  applyDraftDuelPick,
  createDraftDuelDraft,
  draftDuelClaimedPlayerIds,
  draftDuelCurrentPicker,
  draftDuelLegalPicks,
  draftDuelRoster,
  draftDuelTimeoutPick,
  isDraftDuelComplete,
  repositionDraftDuelCard,
  DraftDuelDraftError,
  type DraftDuelPickInput,
} from './draft.ts';
import {
  assessDraftDuelOffers,
  assignSlots,
  buildDraftDuelSafetyInput,
  completionFeasible,
  draftDuelParticipantCompletionPossible,
  draftDuelRepositionSlots,
  neededGroups,
  rosterCompletionPossible,
} from './feasibility.ts';
import {
  buildRoundOffers,
  draftDuelFairAttemptForState,
  draftDuelFairBandTokens,
  DraftDuelGenerationError,
} from './offers.ts';
import { draftDuelHomeWinner, draftDuelTimeoutSeedPath } from './seeds.ts';
import {
  applyDraftDuelGameResult,
  createDraftDuelSeries,
  draftDuelHomeForGame,
  draftDuelSeriesMvp,
  draftDuelSimulationTeam,
  draftDuelStandouts,
  type DraftDuelPlayedGame,
  type DraftDuelSeriesRosters,
} from './series.ts';
import { replayDraftDuelLog } from './log.ts';

const SEED_A = seedSchema.parse(seedFromString('draft-duel-seed-a'));
const SEED_B = seedSchema.parse(seedFromString('draft-duel-seed-b'));
const SEED_C = seedSchema.parse(seedFromString('draft-duel-seed-c'));
const CATALOG_HASH = contentHashSchema.parse('b'.repeat(64));
const FAIRNESS_MODES = ['fair', 'unfair'] as const;

interface VersionSpec {
  positions?: Position[];
  band?: number;
  overall?: number;
}

interface PlayerSpec {
  id: string;
  positions: Position[];
  band: number;
  overall?: number;
  versions?: VersionSpec[];
}

function bandOverall(band: number): number {
  const definition = OVERALL_BANDS[band];
  if (!definition) return 70;
  return Math.min(definition.max, Math.floor((definition.min + definition.max) / 2));
}

function buildCatalogFromSpecs(specs: readonly PlayerSpec[], shuffled?: boolean): DraftDuelCatalog {
  const entries: DraftDuelCatalogEntry[] = [];
  for (const spec of specs) {
    const playerId = playerIdSchema.parse(spec.id);
    const versions: VersionSpec[] =
      spec.versions && spec.versions.length > 0 ? spec.versions : [{}];
    versions.forEach((version, index) => {
      const positions = version.positions ?? spec.positions;
      const band = version.band ?? spec.band;
      const overall = version.overall ?? spec.overall ?? bandOverall(band);
      const material = `${spec.id}:v${String(index)}`;
      const displayName = `Player ${spec.id} v${String(index + 1)}`;
      const playerVersionId = `pv-${seasonDigestHex(material).slice(0, 32)}`;
      entries.push(
        draftDuelCatalogEntrySchema.parse({
          card: {
            cardId: `card-${seasonDigestHex(`${material}:card`).slice(0, 32)}`,
            playerId,
            playerVersionId,
            displayName,
            seasonKey: '1990-91',
            franchiseId: 'lakers',
            eraId: '1990s',
            positions,
            overall,
            bandIndex: band,
          },
          simulation: buildSimulationPlayer({ playerId, displayName, positions, playerVersionId }),
        }),
      );
    });
  }
  const ordered = shuffled ? shuffle(entries, createRng('draft-duel-test-shuffle')) : entries;
  return buildDraftDuelCatalog({
    catalogVersion: 'test-catalog-v1',
    catalogHash: CATALOG_HASH,
    dataVersion: 'data-v1',
    ratingsVersion: 'ratings-v1',
    playerVersionIdVersion: 'pv-v1',
    positionNormalizationVersion: 'position-v1',
    entries: ordered,
  });
}

const GROUP_PROFILES: Position[][] = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG', 'SG'],
  ['SF', 'PF'],
  ['PF', 'C'],
  ['SG', 'SF'],
  ['PG', 'C'],
];

const NO_CENTER_PROFILES: Position[][] = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['PG', 'SG'],
  ['SF', 'PF'],
  ['SG', 'SF'],
  ['PG', 'PF'],
];

const TIGHT_PROFILES: Position[][] = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['PG', 'SF'],
  ['SG', 'PF'],
  ['PG', 'SG'],
  ['SF', 'PF'],
];

function specsForBands(
  perBand: number,
  profiles: readonly Position[][],
  idPrefix: string,
): PlayerSpec[] {
  const specs: PlayerSpec[] = [];
  for (let band = 0; band < 10; band += 1) {
    for (let index = 0; index < perBand; index += 1) {
      const profile = profiles[(band + index) % profiles.length] ?? ['PG'];
      specs.push({
        id: `${idPrefix}-${String(band)}-${String(index)}`,
        positions: profile,
        band,
      });
    }
  }
  return specs;
}

function standardSpecs(): PlayerSpec[] {
  const specs = specsForBands(8, GROUP_PROFILES, 'p');
  for (let index = 0; index < specs.length; index += 3) {
    const spec = specs[index];
    if (!spec) continue;
    const versionCount = (index % 3) + 2;
    spec.versions = Array.from({ length: versionCount }, () => ({}));
  }
  return specs;
}

function scarceCenterSpecs(): PlayerSpec[] {
  return [
    ...specsForBands(8, NO_CENTER_PROFILES, 'sc'),
    { id: 'sc-c0', positions: ['C'], band: 5 },
    { id: 'sc-c1', positions: ['C'], band: 6 },
    { id: 'sc-c2', positions: ['C'], band: 7 },
    { id: 'sc-c3', positions: ['PF', 'C'], band: 5 },
    { id: 'sc-c4', positions: ['PF', 'C'], band: 6 },
    { id: 'sc-c5', positions: ['C'], band: 8 },
    { id: 'sc-c6', positions: ['PF', 'C'], band: 8 },
    { id: 'sc-c7', positions: ['C'], band: 9 },
    { id: 'sc-c8', positions: ['PF', 'C'], band: 9 },
  ];
}

function tightEligibilitySpecs(): PlayerSpec[] {
  return [
    ...specsForBands(5, TIGHT_PROFILES, 'te'),
    { id: 'te-c0', positions: ['C'], band: 4 },
    { id: 'te-c1', positions: ['C'], band: 5 },
    { id: 'te-c2', positions: ['PF', 'C'], band: 6 },
    { id: 'te-c3', positions: ['PF', 'C'], band: 7 },
    { id: 'te-c4', positions: ['C'], band: 8 },
    { id: 'te-c5', positions: ['PF', 'C'], band: 8 },
    { id: 'te-c6', positions: ['C'], band: 9 },
    { id: 'te-c7', positions: ['PF', 'C'], band: 9 },
  ];
}

function cardOf(catalog: DraftDuelCatalog, playerId: string, versionIndex = 0): DraftDuelCard {
  const entry = (catalog.byPlayerId.get(playerId) ?? [])[versionIndex];
  if (!entry) throw new Error(`missing card for ${playerId}`);
  return entry.card;
}

function slotGroupAt(slotIndex: number) {
  const position = LINEUP_STRUCTURE[slotIndex];
  if (position === undefined) throw new Error(`missing lineup slot ${String(slotIndex)}`);
  return slotGroupOf(position);
}

function pickInput(
  participantId: DraftDuelParticipantId,
  card: DraftDuelCard,
  slotIndex?: number,
): DraftDuelPickInput {
  return {
    participantId,
    playerId: card.playerId,
    playerVersionId: card.playerVersionId,
    ...(slotIndex === undefined ? {} : { slotIndex }),
  };
}

function chooseFirstAvailable(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
): DraftDuelPickInput {
  const available = draftDuelLegalPicks(state, catalog).filter((option) => option.available);
  const first = available[0];
  if (!first) throw new Error('draft has no legal picks');
  return pickInput(draftDuelCurrentPicker(state), first.card);
}

function playFullDraft(
  rootSeed: Seed,
  catalog: DraftDuelCatalog,
  fairness: 'fair' | 'unfair' = 'fair',
): DraftDuelDraft {
  let state = createDraftDuelDraft({ rootSeed, fairness, catalog });
  while (!isDraftDuelComplete(state)) {
    state = applyDraftDuelPick(state, catalog, chooseFirstAvailable(state, catalog));
    if (state.status === 'drafting' && state.pickOrdinal >= 10) {
      throw new Error('draft overflow');
    }
  }
  return state;
}

function playFullDraftWithSlots(
  rootSeed: Seed,
  catalog: DraftDuelCatalog,
  fairness: 'fair' | 'unfair' = 'fair',
): DraftDuelDraft {
  let state = createDraftDuelDraft({ rootSeed, fairness, catalog });
  while (!isDraftDuelComplete(state)) {
    const picker = draftDuelCurrentPicker(state);
    const option = draftDuelLegalPicks(state, catalog).find(
      (entry) => entry.available && (entry.legalSlots?.length ?? 0) > 0,
    );
    if (!option) throw new Error('draft has no legal placements');
    const legalSlots = option.legalSlots ?? [];
    const slotIndex = legalSlots[legalSlots.length - 1];
    if (slotIndex === undefined) throw new Error('legal placement lost its slot');
    state = applyDraftDuelPick(state, catalog, pickInput(picker, option.card, slotIndex));
  }
  return state;
}

function expectDraftError(run: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DraftDuelDraftError);
  expect((thrown as DraftDuelDraftError).code).toBe(code);
}

function requirePick(picks: readonly DraftDuelOfferedPick[], slot: number): DraftDuelOfferedPick {
  const pick = picks[slot];
  if (!pick) throw new Error(`missing offered pick at slot ${String(slot)}`);
  return pick;
}

function expectValidRoster(roster: DraftDuelRoster): void {
  expect(roster.slots).toHaveLength(5);
  const slotIndexes = roster.slots.map((slot) => slot.slotIndex).sort((a, b) => a - b);
  expect(slotIndexes).toEqual([0, 1, 2, 3, 4]);
  for (const slot of roster.slots) {
    expect(cardPlayableAt(slot.card, slotGroupAt(slot.slotIndex))).toBe(true);
  }
}

function expectRoundStartSafety(state: DraftDuelDraft, catalog: DraftDuelCatalog): void {
  if (isDraftDuelComplete(state) || state.pickOrdinal % 2 !== 0) return;
  const assessments = draftDuelLegalPicks(state, catalog);
  expect(assessments).toHaveLength(8);
  const legal = assessments.filter((option) => option.available);
  expect(legal.length).toBeGreaterThan(0);
  const picker = draftDuelCurrentPicker(state);
  for (const option of legal) {
    const legalSlots = option.legalSlots ?? [];
    expect(legalSlots.length).toBeGreaterThan(0);
    for (const slotIndex of legalSlots) {
      const after = applyDraftDuelPick(state, catalog, pickInput(picker, option.card, slotIndex));
      const opponentPlacements = draftDuelLegalPicks(after, catalog).filter(
        (entry) => entry.available,
      );
      expect(opponentPlacements.length).toBeGreaterThan(0);
      const safety = buildDraftDuelSafetyInput(
        after,
        catalog,
        after.rounds[Math.floor(after.pickOrdinal / 2)]?.offers ?? {
          p1: [],
          p2: [],
        },
      );
      for (const participant of ['p1', 'p2'] as const) {
        expect(draftDuelParticipantCompletionPossible(safety, participant)).toBe(true);
      }
    }
  }
}

function buildHandState(options: {
  firstPicker: DraftDuelParticipantId;
  picks: Array<{ participantId: DraftDuelParticipantId; card: DraftDuelCard; slotIndex?: number }>;
  currentOffers: { p1: DraftDuelCard[]; p2: DraftDuelCard[] };
  placeholder: DraftDuelCard;
}): DraftDuelDraft {
  const rounds: DraftDuelRound[] = [];
  for (let round = 1; round <= 5; round += 1) {
    rounds.push({
      round,
      offers: {
        p1: Array.from({ length: 8 }, () => options.placeholder),
        p2: Array.from({ length: 8 }, () => options.placeholder),
      },
      picks: [],
    });
  }
  options.picks.forEach((pick, ordinal) => {
    const round = rounds[Math.floor(ordinal / 2)];
    if (!round) throw new Error(`hand state has no round for ordinal ${String(ordinal)}`);
    const entry: DraftDuelPick = {
      pickOrdinal: ordinal,
      round: round.round,
      slot: 0,
      participantId: pick.participantId,
      card: pick.card,
      ...(pick.slotIndex === undefined ? {} : { slotIndex: pick.slotIndex }),
    };
    round.picks.push(entry);
  });
  const pickOrdinal = options.picks.length;
  const currentRound = rounds[Math.floor(pickOrdinal / 2)];
  if (currentRound) currentRound.offers = options.currentOffers;
  return {
    schemaVersion: 1,
    rootSeed: SEED_A,
    fairness: 'fair',
    firstPicker: options.firstPicker,
    pickOrdinal,
    rounds,
    status: pickOrdinal === 10 ? 'complete' : 'drafting',
  };
}

function slotHandState(catalog: DraftDuelCatalog): {
  state: DraftDuelDraft;
  offers: { p1: DraftDuelCard[]; p2: DraftDuelCard[] };
} {
  const offers = {
    p1: ['s-g2', 's-f2', 's-c1', 's-hgf', 's-hgc', 's-g3', 's-f3', 's-c2'].map((id) =>
      cardOf(catalog, id),
    ),
    p2: ['s-g2', 's-f2', 's-c1', 's-hgf', 's-hgc', 's-g3', 's-f3', 's-c2'].map((id) =>
      cardOf(catalog, id),
    ),
  };
  const state = buildHandState({
    firstPicker: 'p1',
    picks: [
      { participantId: 'p1', card: cardOf(catalog, 's-g1'), slotIndex: 0 },
      { participantId: 'p2', card: cardOf(catalog, 's-f1'), slotIndex: 2 },
    ],
    currentOffers: offers,
    placeholder: cardOf(catalog, 's-c3'),
  });
  return { state, offers };
}

function completionHandCatalog(): DraftDuelCatalog {
  return buildCatalogFromSpecs([
    { id: 'h-g1', positions: ['PG'], band: 5 },
    { id: 'h-f1', positions: ['SF'], band: 7 },
    { id: 'h-g2', positions: ['PG'], band: 6 },
    { id: 'h-c2', positions: ['C'], band: 4 },
    { id: 'h-fa', positions: ['SF'], band: 8 },
    { id: 'h-fb', positions: ['SF'], band: 9 },
    { id: 'h-g3', positions: ['PG'], band: 4 },
    { id: 'h-g4', positions: ['SG'], band: 5 },
    { id: 'h-g5', positions: ['PG'], band: 6 },
    { id: 'h-ca', positions: ['C'], band: 7 },
    { id: 'h-cb', positions: ['C'], band: 8 },
    { id: 'h-g6', positions: ['SG'], band: 0 },
  ]);
}

function positionHandCatalog(): DraftDuelCatalog {
  return buildCatalogFromSpecs([
    { id: 'x-g1', positions: ['PG'], band: 5 },
    { id: 'x-g2', positions: ['SG'], band: 6 },
    { id: 'x-g3', positions: ['PG'], band: 7 },
    { id: 'x-g4', positions: ['SG'], band: 8 },
    { id: 'x-g5', positions: ['PG'], band: 4 },
    { id: 'x-fa', positions: ['SF'], band: 9 },
    { id: 'x-fb', positions: ['PF'], band: 0 },
    { id: 'x-fc', positions: ['SF'], band: 1 },
    { id: 'x-fd', positions: ['PF'], band: 5 },
    { id: 'x-ca', positions: ['C'], band: 2 },
    { id: 'x-cb', positions: ['C'], band: 3 },
  ]);
}

function slotTestCatalog(): DraftDuelCatalog {
  return buildCatalogFromSpecs([
    { id: 's-g1', positions: ['PG'], band: 1 },
    { id: 's-g2', positions: ['SG'], band: 2 },
    { id: 's-g3', positions: ['PG'], band: 3 },
    { id: 's-g4', positions: ['SG'], band: 4 },
    { id: 's-f1', positions: ['SF'], band: 5 },
    { id: 's-f2', positions: ['PF'], band: 6 },
    { id: 's-f3', positions: ['SF'], band: 7 },
    { id: 's-f4', positions: ['PF'], band: 8 },
    { id: 's-c1', positions: ['C'], band: 9 },
    { id: 's-c2', positions: ['C'], band: 0 },
    { id: 's-c3', positions: ['C'], band: 1 },
    { id: 's-hgf', positions: ['PG', 'SF'], band: 2 },
    { id: 's-hgc', positions: ['SG', 'C'], band: 3 },
  ]);
}

function buildBox(
  playerId: string,
  options: { points: number; assists?: number; rebounds?: number; fgm?: number; fga?: number },
): PlayerBoxScore {
  const fgm = options.fgm ?? 5;
  const fga = options.fga ?? 10;
  const rebounds = options.rebounds ?? 0;
  return {
    playerId: playerIdSchema.parse(playerId),
    minutes: 36,
    points: options.points,
    fieldGoals: { made: fgm, attempted: fga },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: rebounds, offensive: 0, defensive: rebounds },
    assists: options.assists ?? 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  };
}

function makeTeamResult(teamId: string, displayName: string, boxes: PlayerBoxScore[]): TeamResult {
  return teamResultSchema.parse({
    teamId,
    displayName,
    box: {
      teamId,
      points: boxes.reduce((sum, box) => sum + box.points, 0),
      fieldGoals: {
        made: boxes.reduce((sum, box) => sum + box.fieldGoals.made, 0),
        attempted: boxes.reduce((sum, box) => sum + box.fieldGoals.attempted, 0),
      },
      threes: { made: 0, attempted: 0 },
      freeThrows: { made: 0, attempted: 0 },
      rebounds: {
        total: boxes.reduce((sum, box) => sum + box.rebounds.total, 0),
        offensive: 0,
        defensive: boxes.reduce((sum, box) => sum + box.rebounds.total, 0),
        team: 0,
      },
      assists: boxes.reduce((sum, box) => sum + box.assists, 0),
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
      possessions: 95,
    },
    players: boxes,
    shotZones: SHOT_ZONES.map((zone) => ({ zone, attempts: 10, makes: 5 })),
  });
}

function makeGameResult(
  gameNumber: number,
  home: TeamResult,
  away: TeamResult,
  winner: 'home' | 'away',
): GameResult {
  return gameResultSchema.parse({
    schemaVersion: 1,
    gameNumber,
    seed: seedFromString(`game-${String(gameNumber)}`),
    engineVersion: 'test-engine',
    dataVersion: 'data-v1',
    profileVersion: 'profile-v1',
    home,
    away,
    periodScores: { home: [25, 25, 25, 25], away: [24, 24, 24, 24] },
    winner,
    overtimePeriods: 0,
    facts: [],
  });
}

function playedGame(
  gameNumber: number,
  homeBoxes: PlayerBoxScore[],
  awayBoxes: PlayerBoxScore[],
  winner: 'home' | 'away',
): DraftDuelPlayedGame {
  return {
    gameNumber,
    homeParticipantId: 'p1',
    awayParticipantId: 'p2',
    result: makeGameResult(
      gameNumber,
      makeTeamResult('draft-duel-p1', 'Draft Duel P1', homeBoxes),
      makeTeamResult('draft-duel-p2', 'Draft Duel P2', awayBoxes),
      winner,
    ),
  };
}

function rosterFor(
  catalog: DraftDuelCatalog,
  participantId: DraftDuelParticipantId,
  playerIds: readonly string[],
): DraftDuelRoster {
  return {
    participantId,
    slots: playerIds.map((playerId, slotIndex) => ({
      slotIndex,
      card: cardOf(catalog, playerId),
    })),
  };
}

function dummyAwayBoxes(): PlayerBoxScore[] {
  return Array.from({ length: 5 }, (_, index) => buildBox(`opp-${String(index)}`, { points: 0 }));
}

describe('draft state', () => {
  const catalog = buildCatalogFromSpecs(standardSpecs());

  it('plays full fair and unfair drafts with valid accounting', () => {
    for (const fairness of FAIRNESS_MODES) {
      for (const seed of [SEED_A, SEED_B, SEED_C]) {
        const state = playFullDraft(seed, catalog, fairness);
        expect(draftDuelDraftSchema.safeParse(state).success).toBe(true);
        expect(state.status).toBe('complete');
        expect(state.pickOrdinal).toBe(10);
        expect(isDraftDuelComplete(state)).toBe(true);
        const picks: DraftDuelPick[] = [];
        for (const round of state.rounds) {
          expect(round.picks).toHaveLength(2);
          for (const pick of round.picks) picks.push(pick);
        }
        expect(picks).toHaveLength(10);
        const slotUsage = new Map<DraftDuelParticipantId, Set<number>>([
          ['p1', new Set<number>()],
          ['p2', new Set<number>()],
        ]);
        picks.forEach((pick, ordinal) => {
          const expectedPicker =
            ordinal % 2 === 0 ? state.firstPicker : state.firstPicker === 'p1' ? 'p2' : 'p1';
          expect(pick.participantId).toBe(expectedPicker);
          const round = state.rounds[pick.round - 1];
          const offered = round?.offers[pick.participantId][pick.slot];
          expect(offered?.playerId).toBe(pick.card.playerId);
          expect(offered?.playerVersionId).toBe(pick.card.playerVersionId);
          expect(pick.slotIndex).toBeGreaterThanOrEqual(0);
          expect(pick.slotIndex).toBeLessThanOrEqual(4);
          const used = slotUsage.get(pick.participantId);
          if (!used) throw new Error('missing participant slot usage');
          expect(used.has(pick.slotIndex ?? -1)).toBe(false);
          if (pick.slotIndex !== undefined) used.add(pick.slotIndex);
        });
        for (const round of state.rounds) {
          for (const participant of ['p1', 'p2'] as const) {
            const offers = round.offers[participant];
            expect(new Set(offers.map((card) => card.playerId)).size).toBe(8);
          }
        }
        const roster1 = draftDuelRoster(state, catalog, 'p1');
        const roster2 = draftDuelRoster(state, catalog, 'p2');
        expectValidRoster(roster1);
        expectValidRoster(roster2);
        for (const participant of ['p1', 'p2'] as const) {
          const roster = participant === 'p1' ? roster1 : roster2;
          for (const pick of picks) {
            if (pick.participantId !== participant || pick.slotIndex === undefined) continue;
            const slot = roster.slots.find((entry) => entry.slotIndex === pick.slotIndex);
            expect(slot?.card.playerVersionId).toBe(pick.card.playerVersionId);
          }
        }
        const allPlayers = new Set([
          ...roster1.slots.map((slot) => slot.card.playerId),
          ...roster2.slots.map((slot) => slot.card.playerId),
        ]);
        expect(allPlayers.size).toBe(10);
        expect([...draftDuelClaimedPlayerIds(state)].sort()).toEqual([...allPlayers].sort());
        const phasePicks = draftDuelLegalPicks(state, catalog);
        expect(phasePicks).toHaveLength(8);
        for (const entry of phasePicks) {
          expect(entry.available).toBe(false);
          expect(entry.reason).toBe('phase');
          expect(entry.legalSlots).toEqual([]);
        }
      }
    }
  });

  it('plays a big seeded case across 400 players', () => {
    const specs: PlayerSpec[] = [];
    for (let band = 0; band < 10; band += 1) {
      for (let index = 0; index < 40; index += 1) {
        specs.push({
          id: `big-${String(band)}-${String(index)}`,
          positions: GROUP_PROFILES[(band + index) % GROUP_PROFILES.length] ?? ['PG'],
          band,
        });
      }
    }
    const big = buildCatalogFromSpecs(specs);
    const state = playFullDraft(SEED_A, big);
    expect(state.status).toBe('complete');
    expect(state.pickOrdinal).toBe(10);
    const replay = playFullDraft(SEED_A, big);
    expect(replay).toEqual(state);
    const roster = draftDuelRoster(state, big, 'p2');
    expectValidRoster(roster);
  });

  it('completes a full draft on an eight-thousand-card catalog', () => {
    const specs: PlayerSpec[] = [];
    for (let band = 0; band < 10; band += 1) {
      for (let index = 0; index < 200; index += 1) {
        specs.push({
          id: `scale-${String(band)}-${String(index)}`,
          positions: GROUP_PROFILES[(band + index) % GROUP_PROFILES.length] ?? ['PG'],
          band,
          versions: [{}, {}, {}, {}],
        });
      }
    }
    const scale = buildCatalogFromSpecs(specs);
    expect(scale.entries.length).toBe(8000);
    const state = playFullDraft(SEED_A, scale, 'fair');
    expect(state.status).toBe('complete');
    expect(draftDuelRoster(state, scale, 'p1').slots).toHaveLength(5);
  });

  it('claims every version of a player for both participants', () => {
    const state = createDraftDuelDraft({ rootSeed: SEED_A, fairness: 'fair', catalog });
    const picker = draftDuelCurrentPicker(state);
    const available = draftDuelLegalPicks(state, catalog).filter((option) => option.available);
    const choice = available[0];
    if (!choice) throw new Error('no legal first pick');
    const next = applyDraftDuelPick(state, catalog, pickInput(picker, choice.card));
    expect(draftDuelClaimedPlayerIds(next).has(choice.card.playerId)).toBe(true);
    const partialRoster = draftDuelRoster(next, catalog, picker);
    expect(partialRoster.slots).toHaveLength(1);
    const partialSlot = partialRoster.slots[0];
    if (!partialSlot) throw new Error('missing partial roster slot');
    expect(partialSlot.card.playerVersionId).toBe(choice.card.playerVersionId);
    expect(cardPlayableAt(partialSlot.card, slotGroupAt(partialSlot.slotIndex))).toBe(true);
    const round = next.rounds[0];
    const opponent = picker === 'p1' ? 'p2' : 'p1';
    const opponentOffers = round?.offers[opponent] ?? [];
    for (let slot = 0; slot < opponentOffers.length; slot += 1) {
      const card = opponentOffers[slot];
      if (card?.playerId !== choice.card.playerId) continue;
      const assessment = draftDuelLegalPicks(next, catalog)[slot];
      expect(assessment?.available).toBe(false);
      expect(assessment?.reason).toBe('claimed');
      expect(assessment?.legalSlots).toEqual([]);
    }
  });
});

describe('round safety', () => {
  it('keeps the opponent pickable after every legal first pick', () => {
    const catalogs = [
      buildCatalogFromSpecs(standardSpecs()),
      buildCatalogFromSpecs(scarceCenterSpecs()),
      buildCatalogFromSpecs(tightEligibilitySpecs()),
    ];
    let overlappingRounds = 0;
    for (const catalog of catalogs) {
      for (const seed of [SEED_A, SEED_B]) {
        for (const fairness of FAIRNESS_MODES) {
          let state = createDraftDuelDraft({ rootSeed: seed, fairness, catalog });
          while (!isDraftDuelComplete(state)) {
            expectRoundStartSafety(state, catalog);
            const round = state.rounds[Math.floor(state.pickOrdinal / 2)];
            if (round) {
              const p1Players = new Set(round.offers.p1.map((card) => card.playerId));
              if (round.offers.p2.some((card) => p1Players.has(card.playerId))) {
                overlappingRounds += 1;
              }
            }
            state = applyDraftDuelPick(state, catalog, chooseFirstAvailable(state, catalog));
          }
          expect(isDraftDuelComplete(state)).toBe(true);
        }
      }
    }
    expect(overlappingRounds).toBeGreaterThan(0);
  });

  it('marks a pick that strands the opponent as completion-blocked', () => {
    const catalog = completionHandCatalog();
    const placeholder = cardOf(catalog, 'h-g6');
    const offers = {
      p1: ['h-fa', 'h-g3', 'h-ca', 'h-g4', 'h-cb', 'h-g5', 'h-fb', 'h-g6'].map((id) =>
        cardOf(catalog, id),
      ),
      p2: ['h-fa', 'h-g3', 'h-ca', 'h-g4', 'h-cb', 'h-g5', 'h-fb', 'h-g6'].map((id) =>
        cardOf(catalog, id),
      ),
    };
    const state = buildHandState({
      firstPicker: 'p1',
      picks: [
        { participantId: 'p1', card: cardOf(catalog, 'h-g1'), slotIndex: 0 },
        { participantId: 'p2', card: cardOf(catalog, 'h-g2'), slotIndex: 0 },
        { participantId: 'p1', card: cardOf(catalog, 'h-f1'), slotIndex: 2 },
        { participantId: 'p2', card: cardOf(catalog, 'h-c2'), slotIndex: 4 },
      ],
      currentOffers: offers,
      placeholder,
    });
    const assessments = draftDuelLegalPicks(state, catalog);
    expect(requirePick(assessments, 0).reason).toBe('completion');
    expect(requirePick(assessments, 0).available).toBe(false);
    expect(requirePick(assessments, 1).available).toBe(true);
    expectDraftError(
      () => applyDraftDuelPick(state, catalog, pickInput('p1', requirePick(assessments, 0).card)),
      'illegal',
    );
    expectDraftError(
      () =>
        applyDraftDuelPick(state, catalog, pickInput('p1', requirePick(assessments, 0).card, 3)),
      'illegal',
    );
    const next = applyDraftDuelPick(
      state,
      catalog,
      pickInput('p1', requirePick(assessments, 1).card),
    );
    expect(next.pickOrdinal).toBe(5);
  });

  it('marks a card that cannot be slotted as position-blocked', () => {
    const catalog = positionHandCatalog();
    const placeholder = cardOf(catalog, 'x-fd');
    const offers = {
      p1: ['x-g3', 'x-fb', 'x-fc', 'x-ca', 'x-cb', 'x-g4', 'x-g5', 'x-fd'].map((id) =>
        cardOf(catalog, id),
      ),
      p2: ['x-g3', 'x-fb', 'x-fc', 'x-ca', 'x-cb', 'x-g4', 'x-g5', 'x-fd'].map((id) =>
        cardOf(catalog, id),
      ),
    };
    const state = buildHandState({
      firstPicker: 'p1',
      picks: [
        { participantId: 'p1', card: cardOf(catalog, 'x-g1'), slotIndex: 0 },
        { participantId: 'p2', card: cardOf(catalog, 'x-fa'), slotIndex: 2 },
        { participantId: 'p1', card: cardOf(catalog, 'x-g2'), slotIndex: 1 },
        { participantId: 'p2', card: cardOf(catalog, 'x-fc'), slotIndex: 3 },
      ],
      currentOffers: offers,
      placeholder,
    });
    const assessments = draftDuelLegalPicks(state, catalog);
    expect(requirePick(assessments, 0).reason).toBe('position');
    expect(requirePick(assessments, 1).available).toBe(true);
    expectDraftError(
      () => applyDraftDuelPick(state, catalog, pickInput('p1', requirePick(assessments, 0).card)),
      'illegal',
    );
  });

  it('flags cards offered to the wrong participant as turn-blocked', () => {
    const catalog = buildCatalogFromSpecs(standardSpecs());
    const state = createDraftDuelDraft({ rootSeed: SEED_A, fairness: 'fair', catalog });
    const round = state.rounds[0];
    if (!round) throw new Error('missing round');
    const picker = draftDuelCurrentPicker(state);
    const other = picker === 'p1' ? 'p2' : 'p1';
    const input = buildDraftDuelSafetyInput(state, catalog, round.offers);
    const turnAssessment = assessDraftDuelOffers(input, other);
    for (const entry of turnAssessment) {
      expect(entry.available).toBe(false);
      expect(entry.reason).toBe('turn');
    }
  });
});

describe('slot selection', () => {
  const catalog = buildCatalogFromSpecs(standardSpecs());

  it('lists exactly the safe empty slots for each offered card', () => {
    const handCatalog = slotTestCatalog();
    const { state } = slotHandState(handCatalog);
    const assessments = draftDuelLegalPicks(state, handCatalog);
    expect(requirePick(assessments, 0).legalSlots).toEqual([1]);
    expect(requirePick(assessments, 0).available).toBe(true);
    expect(requirePick(assessments, 1).legalSlots).toEqual([2, 3]);
    expect(requirePick(assessments, 2).legalSlots).toEqual([4]);
    expect(requirePick(assessments, 3).legalSlots).toEqual([1, 2, 3]);
    expect(requirePick(assessments, 4).legalSlots).toEqual([1, 4]);
    expect(requirePick(assessments, 5).legalSlots).toEqual([1]);
    expect(requirePick(assessments, 6).legalSlots).toEqual([2, 3]);
    expect(requirePick(assessments, 7).legalSlots).toEqual([4]);
    const placed = applyDraftDuelPick(
      state,
      handCatalog,
      pickInput('p1', requirePick(assessments, 3).card, 3),
    );
    expect(placed.rounds[1]?.picks[0]?.slotIndex).toBe(3);
    expect(placed.pickOrdinal).toBe(3);
  });

  it('matches legalSlots against accept or reject on a real round', () => {
    for (const seed of [SEED_A, SEED_B]) {
      const state = createDraftDuelDraft({ rootSeed: seed, fairness: 'fair', catalog });
      const picker = draftDuelCurrentPicker(state);
      const occupied = new Set<number>();
      const assessments = draftDuelLegalPicks(state, catalog);
      for (const option of assessments) {
        const compatible = [0, 1, 2, 3, 4].filter(
          (slot) => !occupied.has(slot) && cardPlayableAt(option.card, slotGroupAt(slot)),
        );
        if (option.reason === 'claimed') {
          expect(option.legalSlots).toEqual([]);
          continue;
        }
        if (compatible.length === 0) {
          expect(option.reason).toBe('position');
          expect(option.legalSlots).toEqual([]);
          continue;
        }
        if ((option.legalSlots ?? []).length === 0) {
          expect(option.reason).toBe('completion');
        }
        for (const slot of compatible) {
          if (option.legalSlots?.includes(slot)) {
            const next = applyDraftDuelPick(state, catalog, pickInput(picker, option.card, slot));
            expect(next.pickOrdinal).toBe(1);
            expect(next.rounds[0]?.picks[0]?.slotIndex).toBe(slot);
          } else {
            expectDraftError(
              () => applyDraftDuelPick(state, catalog, pickInput(picker, option.card, slot)),
              'illegal',
            );
          }
        }
      }
    }
  });

  it('completes full drafts where every pick chooses a slot', () => {
    for (const fairness of FAIRNESS_MODES) {
      for (const seed of [SEED_A, SEED_B, SEED_C]) {
        const state = playFullDraftWithSlots(seed, catalog, fairness);
        expect(draftDuelDraftSchema.safeParse(state).success).toBe(true);
        expect(state.status).toBe('complete');
        expect(state.pickOrdinal).toBe(10);
        expect(playFullDraftWithSlots(seed, catalog, fairness)).toEqual(state);
        const picks = state.rounds.flatMap((round) => round.picks);
        expect(picks).toHaveLength(10);
        const used = new Map<DraftDuelParticipantId, Set<number>>([
          ['p1', new Set<number>()],
          ['p2', new Set<number>()],
        ]);
        for (const pick of picks) {
          if (pick.slotIndex === undefined) throw new Error('pick lost its slotIndex');
          expect(pick.slotIndex).toBeGreaterThanOrEqual(0);
          expect(pick.slotIndex).toBeLessThanOrEqual(4);
          const participantUsed = used.get(pick.participantId);
          if (!participantUsed) throw new Error('missing participant usage');
          expect(participantUsed.has(pick.slotIndex)).toBe(false);
          participantUsed.add(pick.slotIndex);
        }
        const roster1 = draftDuelRoster(state, catalog, 'p1');
        const roster2 = draftDuelRoster(state, catalog, 'p2');
        expectValidRoster(roster1);
        expectValidRoster(roster2);
        for (const participant of ['p1', 'p2'] as const) {
          const roster = participant === 'p1' ? roster1 : roster2;
          for (const pick of picks) {
            if (pick.participantId !== participant || pick.slotIndex === undefined) continue;
            const slot = roster.slots.find((entry) => entry.slotIndex === pick.slotIndex);
            expect(slot?.card.playerVersionId).toBe(pick.card.playerVersionId);
          }
        }
        const allPlayers = new Set([
          ...roster1.slots.map((slot) => slot.card.playerId),
          ...roster2.slots.map((slot) => slot.card.playerId),
        ]);
        expect(allPlayers.size).toBe(10);
      }
    }
  });

  it('falls back to matching for picks without a recorded slot', () => {
    const handCatalog = positionHandCatalog();
    const placeholder = cardOf(handCatalog, 'x-fd');
    const state = buildHandState({
      firstPicker: 'p1',
      picks: [
        { participantId: 'p1', card: cardOf(handCatalog, 'x-g1'), slotIndex: 0 },
        { participantId: 'p2', card: cardOf(handCatalog, 'x-fa') },
        { participantId: 'p1', card: cardOf(handCatalog, 'x-g2') },
      ],
      currentOffers: {
        p1: Array.from({ length: 8 }, () => placeholder),
        p2: Array.from({ length: 8 }, () => placeholder),
      },
      placeholder,
    });
    const roster = draftDuelRoster(state, handCatalog, 'p1');
    expect(roster.slots.map((slot) => slot.slotIndex)).toEqual([0, 1]);
    expect(roster.slots.map((slot) => slot.card.playerId)).toEqual(['x-g1', 'x-g2']);
  });
});

describe('fair offer generation', () => {
  const catalog = buildCatalogFromSpecs(standardSpecs());

  function countBands(values: readonly number[]): number[] {
    const counts = new Array<number>(10).fill(0);
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }

  function isSubMultiset(values: readonly number[], counts: readonly number[]): boolean {
    const used = new Array<number>(counts.length).fill(0);
    for (const value of values) {
      const available = counts[value] ?? 0;
      const index = used[value] ?? 0;
      if (index >= available) return false;
      used[value] = index + 1;
    }
    return true;
  }

  it('shares one 40-token draft histogram between participants', () => {
    const histograms = new Set<string>();
    for (const seed of [SEED_A, SEED_B, SEED_C]) {
      let state = createDraftDuelDraft({ rootSeed: seed, fairness: 'fair', catalog });
      const attempt = draftDuelFairAttemptForState(state, catalog);
      expect(attempt).not.toBeNull();
      const tokenCounts = countBands(draftDuelFairBandTokens(seed, attempt ?? 0));
      const p1Total = new Array<number>(10).fill(0);
      const p2Total = new Array<number>(10).fill(0);
      for (let round = 1; round <= 5; round += 1) {
        const entry = state.rounds[round - 1];
        if (!entry) throw new Error('missing round');
        const p1Bands = entry.offers.p1.map((card) => card.bandIndex);
        const p2Bands = entry.offers.p2.map((card) => card.bandIndex);
        expect(isSubMultiset(p1Bands, tokenCounts)).toBe(true);
        expect(isSubMultiset(p2Bands, tokenCounts)).toBe(true);
        for (const card of entry.offers.p1)
          p1Total[card.bandIndex] = (p1Total[card.bandIndex] ?? 0) + 1;
        for (const card of entry.offers.p2)
          p2Total[card.bandIndex] = (p2Total[card.bandIndex] ?? 0) + 1;
        state = applyDraftDuelPick(state, catalog, chooseFirstAvailable(state, catalog));
        state = applyDraftDuelPick(state, catalog, chooseFirstAvailable(state, catalog));
      }
      expect(p1Total).toEqual(p2Total);
      expect(p1Total).toEqual(tokenCounts);
      expect(draftDuelFairAttemptForState(state, catalog)).toBe(attempt);
      histograms.add(JSON.stringify(p1Total));
    }
    expect(histograms.size).toBeGreaterThan(1);
  });

  it('rejects calls that would regenerate a committed round', () => {
    const state = createDraftDuelDraft({ rootSeed: SEED_A, fairness: 'fair', catalog });
    const next = applyDraftDuelPick(state, catalog, chooseFirstAvailable(state, catalog));
    expect(() => buildRoundOffers(next, catalog)).toThrow(/round starts/);
  });
});

describe('unfair offer generation', () => {
  const specs = standardSpecs();
  const catalog = buildCatalogFromSpecs(specs);

  it('samples unclaimed players without rating bias', () => {
    const seeds = Array.from({ length: 60 }, (_, index) =>
      seedSchema.parse(seedFromString(`unfair-seed-${String(index)}`)),
    );
    const counts = new Map<string, number>();
    const bandCounts = new Array<number>(10).fill(0);
    const overalls: number[] = [];
    const catalogOveralls = catalog.playerIds.map((playerId) => {
      const first = (catalog.byPlayerId.get(playerId) ?? [])[0];
      return first?.card.overall ?? 0;
    });
    const sortedOveralls = [...catalogOveralls].sort((a, b) => a - b);
    const median = sortedOveralls[Math.floor(sortedOveralls.length / 2)] ?? 0;
    let offers = 0;
    for (const seed of seeds) {
      const state = createDraftDuelDraft({ rootSeed: seed, fairness: 'unfair', catalog });
      const round = state.rounds[0];
      if (!round) throw new Error('missing round');
      for (const card of [...round.offers.p1, ...round.offers.p2]) {
        counts.set(card.playerId, (counts.get(card.playerId) ?? 0) + 1);
        overalls.push(card.overall);
        bandCounts[card.bandIndex] = (bandCounts[card.bandIndex] ?? 0) + 1;
        offers += 1;
      }
    }
    expect(overalls.some((overall) => overall < median)).toBe(true);
    expect(overalls.some((overall) => overall > median)).toBe(true);
    const bestSpec = [...specs].sort(
      (a, b) => (b.overall ?? bandOverall(b.band)) - (a.overall ?? bandOverall(a.band)),
    )[0];
    if (!bestSpec) throw new Error('empty specs');
    const topCount = counts.get(bestSpec.id) ?? 0;
    const average = offers / catalog.playerIds.length;
    expect(topCount).toBeLessThanOrEqual(average * 2.5);
    const topBandShare = (bandCounts[0] ?? 0) / offers;
    expect(topBandShare).toBeLessThanOrEqual(0.25);
  });
});

describe('timeout autopick', () => {
  const catalog = buildCatalogFromSpecs(standardSpecs());

  it('samples only legal offered players without a top-overall preference', () => {
    const seeds = Array.from({ length: 60 }, (_, index) =>
      seedSchema.parse(seedFromString(`timeout-seed-${String(index)}`)),
    );
    const counts = new Map<string, number>();
    let topChosen = 0;
    for (const seed of seeds) {
      const state = createDraftDuelDraft({ rootSeed: seed, fairness: 'fair', catalog });
      const legal = draftDuelLegalPicks(state, catalog).filter((option) => option.available);
      const timeout = draftDuelTimeoutPick(state, catalog);
      const matched = legal.find(
        (option) =>
          option.card.playerId === timeout.playerId &&
          option.card.playerVersionId === timeout.playerVersionId,
      );
      expect(matched).toBeDefined();
      expect(matched?.legalSlots).toContain(timeout.slotIndex);
      expect(timeout.slotIndex).toBe(Math.min(...(matched?.legalSlots ?? [])));
      const repeat = draftDuelTimeoutPick(state, catalog);
      expect(repeat).toEqual(timeout);
      const topOverall = Math.max(...legal.map((option) => option.card.overall));
      if (matched?.card.overall === topOverall) topChosen += 1;
      counts.set(timeout.playerId, (counts.get(timeout.playerId) ?? 0) + 1);
      const next = applyDraftDuelPick(state, catalog, {
        participantId: draftDuelCurrentPicker(state),
        playerId: timeout.playerId,
        playerVersionId: timeout.playerVersionId,
        slotIndex: timeout.slotIndex,
      });
      expect(next.pickOrdinal).toBe(1);
      expect(next.rounds[0]?.picks[0]?.slotIndex).toBe(timeout.slotIndex);
    }
    const frequencies = [...counts.values()];
    const min = Math.min(...frequencies);
    const max = Math.max(...frequencies);
    expect(counts.size).toBeGreaterThanOrEqual(4);
    expect(min).toBeGreaterThanOrEqual(1);
    expect(max).toBeLessThanOrEqual(Math.ceil(seeds.length / 4));
    expect(topChosen).toBeLessThanOrEqual(seeds.length * 0.5);
  });

  it('completes timeout-driven drafts', () => {
    for (const seed of [SEED_A, SEED_B]) {
      let state = createDraftDuelDraft({ rootSeed: seed, fairness: 'fair', catalog });
      while (!isDraftDuelComplete(state)) {
        const picker = draftDuelCurrentPicker(state);
        const timeout = draftDuelTimeoutPick(state, catalog);
        expect(timeout.pickOrdinal).toBe(state.pickOrdinal);
        expect(timeout.seedPath).toBe(draftDuelTimeoutSeedPath(picker, state.pickOrdinal));
        expect(timeout.slotIndex).toBeGreaterThanOrEqual(0);
        expect(timeout.slotIndex).toBeLessThanOrEqual(4);
        state = applyDraftDuelPick(state, catalog, {
          participantId: picker,
          playerId: timeout.playerId,
          playerVersionId: timeout.playerVersionId,
          slotIndex: timeout.slotIndex,
        });
      }
      expect(state.status).toBe('complete');
    }
  });
});

describe('determinism', () => {
  it('replays identical scripts and ignores catalog entry order', () => {
    const base = buildCatalogFromSpecs(standardSpecs());
    const shuffled = buildCatalogFromSpecs(standardSpecs(), true);
    for (const seed of [SEED_A, SEED_B]) {
      const first = playFullDraft(seed, base);
      const second = playFullDraft(seed, base);
      const third = playFullDraft(seed, shuffled);
      expect(second).toEqual(first);
      expect(third).toEqual(first);
      const initialA = createDraftDuelDraft({ rootSeed: seed, fairness: 'fair', catalog: base });
      const initialB = createDraftDuelDraft({
        rootSeed: seed,
        fairness: 'fair',
        catalog: shuffled,
      });
      expect(initialB).toEqual(initialA);
    }
  });
});

describe('pick rejections', () => {
  const catalog = buildCatalogFromSpecs(standardSpecs());

  it('rejects picks from the wrong participant', () => {
    const state = createDraftDuelDraft({ rootSeed: SEED_A, fairness: 'fair', catalog });
    const round = state.rounds[0];
    if (!round) throw new Error('missing round');
    const picker = draftDuelCurrentPicker(state);
    const other = picker === 'p1' ? 'p2' : 'p1';
    const card = round.offers[picker][0];
    if (!card) throw new Error('missing card');
    expectDraftError(() => applyDraftDuelPick(state, catalog, pickInput(other, card)), 'turn');
  });

  it('rejects un-offered versions of an offered player', () => {
    const state = createDraftDuelDraft({ rootSeed: SEED_A, fairness: 'fair', catalog });
    const round = state.rounds[0];
    if (!round) throw new Error('missing round');
    const picker = draftDuelCurrentPicker(state);
    let offered: DraftDuelCard | null = null;
    let alternateId: string | null = null;
    for (const card of round.offers[picker]) {
      const versions = catalog.byPlayerId.get(card.playerId) ?? [];
      const alternate = versions.find(
        (entry) => entry.card.playerVersionId !== card.playerVersionId,
      );
      if (alternate) {
        offered = card;
        alternateId = alternate.card.playerVersionId;
        break;
      }
    }
    if (!offered || !alternateId) throw new Error('catalog lacks a multi-version offered player');
    expectDraftError(
      () =>
        applyDraftDuelPick(state, catalog, {
          participantId: picker,
          playerId: offered.playerId,
          playerVersionId: alternateId,
        }),
      'not-offered',
    );
  });

  it('rejects already-claimed players', () => {
    const handCatalog = positionHandCatalog();
    const placeholder = cardOf(handCatalog, 'x-fd');
    const offers = {
      p1: ['x-g3', 'x-fb', 'x-fc', 'x-ca', 'x-cb', 'x-g4', 'x-g5', 'x-fd'].map((id) =>
        cardOf(handCatalog, id),
      ),
      p2: ['x-g1', 'x-g3', 'x-fb', 'x-fc', 'x-ca', 'x-cb', 'x-g4', 'x-fd'].map((id) =>
        cardOf(handCatalog, id),
      ),
    };
    const state = buildHandState({
      firstPicker: 'p1',
      picks: [
        { participantId: 'p1', card: cardOf(handCatalog, 'x-g1'), slotIndex: 0 },
        { participantId: 'p2', card: cardOf(handCatalog, 'x-fa'), slotIndex: 2 },
        { participantId: 'p1', card: cardOf(handCatalog, 'x-g2'), slotIndex: 1 },
      ],
      currentOffers: offers,
      placeholder,
    });
    expectDraftError(
      () => applyDraftDuelPick(state, handCatalog, pickInput('p2', cardOf(handCatalog, 'x-g1'))),
      'claimed',
    );
  });

  it('rejects occupied and out-of-range slots', () => {
    const handCatalog = slotTestCatalog();
    const { state } = slotHandState(handCatalog);
    expectDraftError(
      () => applyDraftDuelPick(state, handCatalog, pickInput('p1', cardOf(handCatalog, 's-g2'), 0)),
      'slot',
    );
    expectDraftError(
      () => applyDraftDuelPick(state, handCatalog, pickInput('p1', cardOf(handCatalog, 's-g2'), 5)),
      'slot',
    );
  });

  it('rejects slots the card cannot play', () => {
    const handCatalog = slotTestCatalog();
    const { state } = slotHandState(handCatalog);
    expectDraftError(
      () => applyDraftDuelPick(state, handCatalog, pickInput('p1', cardOf(handCatalog, 's-g2'), 4)),
      'position',
    );
    expectDraftError(
      () => applyDraftDuelPick(state, handCatalog, pickInput('p1', cardOf(handCatalog, 's-c1'), 1)),
      'position',
    );
  });

  it('rejects picks after the draft is complete', () => {
    const state = playFullDraft(SEED_A, catalog);
    const card = state.rounds[4]?.offers.p2[0];
    if (!card) throw new Error('missing card');
    expectDraftError(() => applyDraftDuelPick(state, catalog, pickInput('p2', card)), 'phase');
    expect(() => draftDuelCurrentPicker(state)).toThrow(DraftDuelDraftError);
  });

  it('rejects offers without a legal pick', () => {
    const handCatalog = completionHandCatalog();
    const placeholder = cardOf(handCatalog, 'h-g6');
    const offers = {
      p1: Array.from({ length: 8 }, () => cardOf(handCatalog, 'h-fa')),
      p2: Array.from({ length: 8 }, () => cardOf(handCatalog, 'h-fa')),
    };
    const state = buildHandState({
      firstPicker: 'p1',
      picks: [
        { participantId: 'p1', card: cardOf(handCatalog, 'h-g1'), slotIndex: 0 },
        { participantId: 'p2', card: cardOf(handCatalog, 'h-g2'), slotIndex: 0 },
      ],
      currentOffers: offers,
      placeholder,
    });
    const input = buildDraftDuelSafetyInput(state, handCatalog, state.rounds[1]?.offers ?? offers);
    const blocked = assessDraftDuelOffers(input, 'p1');
    expect(blocked).toHaveLength(8);
    expect(blocked.some((entry) => entry.available)).toBe(false);
  });
});

describe('generation failure', () => {
  it('throws DraftDuelGenerationError for a catalog too small to draft', () => {
    const tiny = buildCatalogFromSpecs([
      { id: 'tiny-1', positions: ['PG'], band: 0 },
      { id: 'tiny-2', positions: ['C'], band: 9 },
    ]);
    let thrown: unknown;
    try {
      createDraftDuelDraft({ rootSeed: SEED_A, fairness: 'fair', catalog: tiny });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DraftDuelGenerationError);
    expect((thrown as DraftDuelGenerationError).round).toBe(1);
    expect((thrown as DraftDuelGenerationError).attempts).toBe(DRAFT_DUEL_MAX_GENERATION_ATTEMPTS);
    expect((thrown as Error).message).toMatch(/round 1/);
  });
});

describe('feasibility primitives', () => {
  it('assigns slots lexicographically and reports needs', () => {
    const catalog = buildCatalogFromSpecs([
      { id: 'f-hybrid', positions: ['PG', 'SF'], band: 3 },
      { id: 'f-guard', positions: ['SG'], band: 4 },
      { id: 'f-big', positions: ['C'], band: 5 },
    ]);
    const hybrid = cardOf(catalog, 'f-hybrid');
    const guard = cardOf(catalog, 'f-guard');
    const big = cardOf(catalog, 'f-big');
    expect(assignSlots([hybrid, guard])).toEqual([0, 1]);
    expect(neededGroups([hybrid, guard])).toEqual({ G: 0, F: 2, C: 1 });
    expect(assignSlots([big, big])).toBeNull();
    expect(assignSlots([hybrid, guard, big])).not.toBeNull();
  });

  it('handles distinct-player scarcity exactly', () => {
    expect(
      completionFeasible({
        needed: { G: 1, F: 1, C: 0 },
        remainingPicks: 2,
        unclaimedProfileCounts: new Map([[3, 1]]),
      }),
    ).toBe(false);
    expect(
      completionFeasible({
        needed: { G: 1, F: 1, C: 0 },
        remainingPicks: 2,
        unclaimedProfileCounts: new Map([
          [3, 1],
          [1, 1],
        ]),
      }),
    ).toBe(true);
    expect(
      completionFeasible({
        needed: { G: 0, F: 0, C: 2 },
        remainingPicks: 2,
        unclaimedProfileCounts: new Map([[4, 1]]),
      }),
    ).toBe(false);
    expect(
      completionFeasible({
        needed: { G: 1, F: 0, C: 0 },
        remainingPicks: 0,
        unclaimedProfileCounts: new Map([[1, 5]]),
      }),
    ).toBe(false);
  });

  it('tries every partial assignment when judging completion', () => {
    const catalog = buildCatalogFromSpecs([
      { id: 'e-hybrid', positions: ['PG', 'SF'], band: 3 },
      { id: 'e-guard1', positions: ['PG'], band: 4 },
      { id: 'e-guard2', positions: ['SG'], band: 5 },
      { id: 'e-forward', positions: ['SF'], band: 6 },
      { id: 'e-center', positions: ['C'], band: 7 },
    ]);
    const hybrid = cardOf(catalog, 'e-hybrid');
    const pools = new Map<number, number>();
    pools.set(1, 2);
    pools.set(2, 1);
    pools.set(4, 1);
    expect(rosterCompletionPossible([hybrid], 4, pools)).toBe(true);
    const poolsWithoutForwards = new Map<number, number>();
    poolsWithoutForwards.set(1, 3);
    poolsWithoutForwards.set(4, 1);
    expect(rosterCompletionPossible([hybrid], 4, poolsWithoutForwards)).toBe(false);
  });
});

describe('series', () => {
  it('maps home court with a 2-2-1-1-1 pattern', () => {
    expect(draftDuelHomeForGame('p1', 1)).toBe('p1');
    expect(draftDuelHomeForGame('p1', 2)).toBe('p1');
    expect(draftDuelHomeForGame('p1', 3)).toBe('p2');
    expect(draftDuelHomeForGame('p1', 4)).toBe('p2');
    expect(draftDuelHomeForGame('p1', 5)).toBe('p1');
    expect(draftDuelHomeForGame('p1', 6)).toBe('p2');
    expect(draftDuelHomeForGame('p1', 7)).toBe('p1');
    expect(() => draftDuelHomeForGame('p1', 0)).toThrow();
    const series = createDraftDuelSeries(SEED_A);
    expect(series.homeWinner).toBe(draftDuelHomeWinner(SEED_A));
    expect(series.currentGameNumber).toBe(1);
    expect(series.champion).toBeNull();
  });

  it('stops at four wins and records games', () => {
    let series = createDraftDuelSeries(SEED_A);
    series = applyDraftDuelGameResult(series, 1, 'p1');
    series = applyDraftDuelGameResult(series, 2, 'p1');
    series = applyDraftDuelGameResult(series, 3, 'p2');
    series = applyDraftDuelGameResult(series, 4, 'p1');
    series = applyDraftDuelGameResult(series, 5, 'p1');
    expect(series.champion).toBe('p1');
    expect(series.currentGameNumber).toBeNull();
    expect(series.p1Wins).toBe(4);
    expect(series.p2Wins).toBe(1);
    expect(series.games).toHaveLength(5);
    expect(series.games.map((game) => game.homeParticipantId)).toEqual([
      series.homeWinner,
      series.homeWinner,
      series.homeWinner === 'p1' ? 'p2' : 'p1',
      series.homeWinner === 'p1' ? 'p2' : 'p1',
      series.homeWinner,
    ]);
    expect(() => applyDraftDuelGameResult(series, 6, 'p2')).toThrow(/complete/);
    const fresh = createDraftDuelSeries(SEED_B);
    expect(() => applyDraftDuelGameResult(fresh, 2, 'p1')).toThrow(/current game/);
  });

  it('builds simulation teams in slot order and requires five slots', () => {
    const catalog = buildCatalogFromSpecs(standardSpecs());
    const state = playFullDraft(SEED_A, catalog);
    const roster = draftDuelRoster(state, catalog, 'p1');
    const team = draftDuelSimulationTeam(catalog, roster, 'p1');
    expect(team.teamId).toBe('draft-duel-p1');
    expect(team.displayName).toBe('Draft Duel P1');
    expect(team.players).toHaveLength(5);
    expect(team.players.map((player) => player.playerVersionId)).toEqual(
      roster.slots.map((slot) => slot.card.playerVersionId),
    );
    expect(() =>
      draftDuelSimulationTeam(
        catalog,
        { participantId: 'p1', slots: roster.slots.slice(0, 4) },
        'p1',
      ),
    ).toThrow(/5 slots/);
  });

  it('breaks MVP ties deterministically', () => {
    const catalog = buildCatalogFromSpecs([
      { id: 'mvp-a', positions: ['PG'], band: 3 },
      { id: 'mvp-b', positions: ['SG'], band: 4 },
      { id: 'mvp-c', positions: ['SF'], band: 5 },
      { id: 'mvp-d', positions: ['PF'], band: 6 },
      { id: 'mvp-e', positions: ['C'], band: 7 },
    ]);
    const rosters: DraftDuelSeriesRosters = {
      p1: rosterFor(catalog, 'p1', ['mvp-a', 'mvp-b', 'mvp-c', 'mvp-d', 'mvp-e']),
      p2: rosterFor(catalog, 'p2', ['mvp-a', 'mvp-b', 'mvp-c', 'mvp-d', 'mvp-e']),
    };
    const zero = (playerId: string) => buildBox(playerId, { points: 0, fgm: 0, fga: 0 });
    const gamesWith = (boxesFor: (gameNumber: number) => PlayerBoxScore[]): DraftDuelPlayedGame[] =>
      [1, 2, 3, 4].map((gameNumber) =>
        playedGame(gameNumber, boxesFor(gameNumber), dummyAwayBoxes(), 'home'),
      );

    const pointsGames = gamesWith(() => [
      buildBox('mvp-a', { points: 20, fgm: 10, fga: 20 }),
      buildBox('mvp-b', { points: 22, fgm: 5, fga: 20 }),
      zero('mvp-c'),
      zero('mvp-d'),
      zero('mvp-e'),
    ]);
    const pointsMvp = draftDuelSeriesMvp(catalog, rosters, pointsGames, 'p1');
    expect(pointsMvp?.playerId).toBe('mvp-b');
    expect(pointsMvp?.games).toBe(4);
    expect(pointsMvp?.points).toBe(88);
    expect(pointsMvp?.displayName).toBe('Player mvp-b v1');

    const assistGames = gamesWith(() => [
      buildBox('mvp-a', { points: 20, fgm: 10, fga: 20, assists: 5 }),
      buildBox('mvp-b', { points: 20, fgm: 10, fga: 20, assists: 2 }),
      zero('mvp-c'),
      zero('mvp-d'),
      zero('mvp-e'),
    ]);
    expect(draftDuelSeriesMvp(catalog, rosters, assistGames, 'p1')?.playerId).toBe('mvp-a');

    const reboundGames = gamesWith(() => [
      buildBox('mvp-a', { points: 20, fgm: 10, fga: 20, assists: 3, rebounds: 6 }),
      buildBox('mvp-b', { points: 20, fgm: 10, fga: 20, assists: 3, rebounds: 9 }),
      zero('mvp-c'),
      zero('mvp-d'),
      zero('mvp-e'),
    ]);
    expect(draftDuelSeriesMvp(catalog, rosters, reboundGames, 'p1')?.playerId).toBe('mvp-b');

    const idGames = gamesWith(() => [
      buildBox('mvp-a', { points: 10, fgm: 5, fga: 10 }),
      buildBox('mvp-b', { points: 10, fgm: 5, fga: 10 }),
      zero('mvp-c'),
      zero('mvp-d'),
      zero('mvp-e'),
    ]);
    expect(draftDuelSeriesMvp(catalog, rosters, idGames, 'p1')?.playerId).toBe('mvp-a');
    expect(draftDuelSeriesMvp(catalog, rosters, [], 'p1')).toBeNull();
  });

  it('picks game standouts from the winning side', () => {
    const catalog = buildCatalogFromSpecs([
      { id: 'sd-a', positions: ['PG'], band: 3 },
      { id: 'sd-b', positions: ['SG'], band: 4 },
      { id: 'sd-c', positions: ['SF'], band: 5 },
      { id: 'sd-d', positions: ['PF'], band: 6 },
      { id: 'sd-e', positions: ['C'], band: 7 },
      { id: 'sd-x', positions: ['PG'], band: 8 },
      { id: 'sd-y', positions: ['SG'], band: 9 },
    ]);
    const rosters: DraftDuelSeriesRosters = {
      p1: rosterFor(catalog, 'p1', ['sd-a', 'sd-b', 'sd-c', 'sd-d', 'sd-e']),
      p2: rosterFor(catalog, 'p2', ['sd-x', 'sd-y', 'sd-a', 'sd-b', 'sd-c']),
    };
    const game1 = playedGame(
      1,
      [
        buildBox('sd-a', { points: 30 }),
        buildBox('sd-b', { points: 30, assists: 5 }),
        buildBox('sd-c', { points: 10 }),
        buildBox('sd-d', { points: 5 }),
        buildBox('sd-e', { points: 2 }),
      ],
      dummyAwayBoxes(),
      'home',
    );
    const game2 = playedGame(
      2,
      dummyAwayBoxes(),
      [
        buildBox('sd-x', { points: 28 }),
        buildBox('sd-y', { points: 28, rebounds: 10 }),
        buildBox('sd-a', { points: 12 }),
        buildBox('sd-b', { points: 4 }),
        buildBox('sd-c', { points: 1 }),
      ],
      'away',
    );
    const standouts = draftDuelStandouts(catalog, rosters, [game1, game2]);
    expect(standouts).toHaveLength(2);
    expect(standouts[0]?.participantId).toBe('p1');
    expect(standouts[0]?.playerId).toBe('sd-b');
    expect(standouts[0]?.assists).toBe(5);
    expect(standouts[0]?.displayName).toBe('Player sd-b v1');
    expect(standouts[1]?.participantId).toBe('p2');
    expect(standouts[1]?.playerId).toBe('sd-y');
    expect(standouts[1]?.rebounds).toBe(10);
  });
});

describe('round generation guards', () => {
  it('refuses to build offers mid-round or when complete', () => {
    const catalog = buildCatalogFromSpecs(standardSpecs());
    const state = createDraftDuelDraft({ rootSeed: SEED_A, fairness: 'fair', catalog });
    const next = applyDraftDuelPick(state, catalog, chooseFirstAvailable(state, catalog));
    expect(() => buildRoundOffers(next, catalog)).toThrow(/round starts/);
    const complete = playFullDraft(SEED_A, catalog);
    expect(() => buildRoundOffers(complete, catalog)).toThrow(/round starts/);
  });
});

describe('draft duel repositioning', () => {
  function stateWithPicks(
    catalog: DraftDuelCatalog,
    picks: Array<{ card: DraftDuelCard; slotIndex: number }>,
    options?: { pickOrdinal?: number },
  ): DraftDuelDraft {
    const filler = catalog.entries[0]?.card;
    if (!filler) throw new Error('fixture catalog has no entries');
    const offers = {
      p1: Array.from({ length: 8 }, () => filler),
      p2: Array.from({ length: 8 }, () => filler),
    };
    const rounds: DraftDuelRound[] = Array.from({ length: 5 }, (_, index) => ({
      round: index + 1,
      offers,
      picks:
        index === 0
          ? picks.map((pick, pickIndex) => ({
              pickOrdinal: pickIndex,
              round: 1,
              slot: pickIndex,
              participantId: 'p1' as const,
              card: pick.card,
              slotIndex: pick.slotIndex,
            }))
          : [],
    }));
    return {
      schemaVersion: 1,
      rootSeed: SEED_A,
      fairness: 'fair',
      firstPicker: 'p1',
      pickOrdinal: options?.pickOrdinal ?? picks.length,
      rounds,
      status: 'drafting',
    };
  }
  function cardMatching(
    catalog: DraftDuelCatalog,
    predicate: (positions: readonly Position[]) => boolean,
  ): DraftDuelCard {
    const entry = catalog.entries.find((candidate) => predicate(candidate.card.positions));
    if (!entry) throw new Error('fixture catalog has no matching card');
    return entry.card;
  }
  it('repositions an own card deterministically without changing the turn', () => {
    const catalog = buildCatalogFromSpecs([
      { id: 'rr-g', positions: ['PG', 'SG'], band: 5 },
      { id: 'rr-sg', positions: ['SG'], band: 5 },
      { id: 'rr-f', positions: ['SF', 'PF'], band: 5 },
      { id: 'rr-pf', positions: ['PF', 'C'], band: 5 },
      { id: 'rr-c', positions: ['C'], band: 5 },
    ]);
    const state = stateWithPicks(catalog, [
      { card: cardOf(catalog, 'rr-g'), slotIndex: 0 },
      { card: cardOf(catalog, 'rr-sg'), slotIndex: 1 },
      { card: cardOf(catalog, 'rr-f'), slotIndex: 2 },
    ]);
    const subject = cardOf(catalog, 'rr-f');
    expect(draftDuelRepositionSlots(state, catalog, 'p1', subject.playerVersionId)).toContain(3);
    const moved = repositionDraftDuelCard(state, catalog, {
      participantId: 'p1',
      playerVersionId: subject.playerVersionId,
      slotIndex: 3,
    });
    expect(moved.pickOrdinal).toBe(state.pickOrdinal);
    expect(moved.status).toBe('drafting');
    expect(moved.rounds[0]?.picks.map((pick) => [pick.card.playerId, pick.slotIndex])).toEqual([
      ['rr-g', 0],
      ['rr-sg', 1],
      ['rr-f', 3],
    ]);
    const roster = draftDuelRoster(moved, catalog, 'p1');
    expect(roster.slots.map((slot) => [slot.card.playerId, slot.slotIndex])).toEqual([
      ['rr-g', 0],
      ['rr-sg', 1],
      ['rr-f', 3],
    ]);
  });
  it('rejects repositions for other participants, illegal positions, and completed drafts', () => {
    const catalog = buildCatalogFromSpecs([
      { id: 'rr-g', positions: ['PG', 'SG'], band: 5 },
      { id: 'rr-f', positions: ['SF', 'PF'], band: 5 },
    ]);
    const state = stateWithPicks(catalog, [{ card: cardOf(catalog, 'rr-f'), slotIndex: 2 }]);
    const subject = cardOf(catalog, 'rr-f');
    expect(() =>
      repositionDraftDuelCard(state, catalog, {
        participantId: 'p2',
        playerVersionId: subject.playerVersionId,
        slotIndex: 3,
      }),
    ).toThrow(/not placed/);
    expect(() =>
      repositionDraftDuelCard(state, catalog, {
        participantId: 'p1',
        playerVersionId: subject.playerVersionId,
        slotIndex: 1,
      }),
    ).toThrow(/cannot play slot/);
    expect(() =>
      repositionDraftDuelCard({ ...state, status: 'complete' }, catalog, {
        participantId: 'p1',
        playerVersionId: subject.playerVersionId,
        slotIndex: 3,
      }),
    ).toThrow(/not drafting/);
  });
  it('rejects repositions that would prevent completing the draft', () => {
    const catalog = buildCatalogFromSpecs([
      { id: 'rc-c', positions: ['PF', 'C'], band: 5 },
      { id: 'rc-g1', positions: ['PG'], band: 5 },
      { id: 'rc-g2', positions: ['SG'], band: 5 },
      { id: 'rc-f1', positions: ['SF'], band: 5 },
      { id: 'rc-f2', positions: ['PF'], band: 5 },
    ]);
    const state = stateWithPicks(catalog, [
      { card: cardOf(catalog, 'rc-g1'), slotIndex: 0 },
      { card: cardOf(catalog, 'rc-g2'), slotIndex: 1 },
      { card: cardOf(catalog, 'rc-c'), slotIndex: 4 },
    ]);
    const subject = cardOf(catalog, 'rc-c');
    expect(draftDuelRepositionSlots(state, catalog, 'p1', subject.playerVersionId)).toEqual([]);
    expect(() =>
      repositionDraftDuelCard(state, catalog, {
        participantId: 'p1',
        playerVersionId: subject.playerVersionId,
        slotIndex: 3,
      }),
    ).toThrow(/no legal completion/);
  });
  it('displaces own cards when picking into an occupied slot', () => {
    const catalog = buildCatalogFromSpecs(standardSpecs());
    const subject = cardMatching(
      catalog,
      (positions) => positions.includes('SF') && positions.includes('PF'),
    );
    const offered = cardMatching(
      catalog,
      (positions) => positions.includes('PF') && positions.includes('C'),
    );
    const base = stateWithPicks(catalog, [{ card: subject, slotIndex: 2 }], { pickOrdinal: 0 });
    const offers = Array.from({ length: 8 }, (_, index) => (index === 0 ? offered : subject));
    const state: DraftDuelDraft = {
      ...base,
      rounds: base.rounds.map((round, index) =>
        index === 0 ? { ...round, offers: { ...round.offers, p1: offers } } : round,
      ),
    };
    const legacyPicks = draftDuelLegalPicks(state, catalog, { allowDisplacement: false });
    expect(legacyPicks[0]?.legalSlots).toEqual([3, 4]);
    const displacementPicks = draftDuelLegalPicks(state, catalog, { allowDisplacement: true });
    expect(displacementPicks[0]?.available).toBe(true);
    expect(displacementPicks[0]?.legalSlots).toEqual([2, 3, 4]);
    const picked = applyDraftDuelPick(
      state,
      catalog,
      {
        participantId: 'p1',
        playerId: offered.playerId,
        playerVersionId: offered.playerVersionId,
        slotIndex: 2,
      },
      { allowDisplacement: true },
    );
    expect(picked.rounds[0]?.picks.map((pick) => [pick.card.playerId, pick.slotIndex])).toEqual([
      [subject.playerId, 3],
      [offered.playerId, 2],
    ]);
    expect(() =>
      applyDraftDuelPick(
        state,
        catalog,
        {
          participantId: 'p1',
          playerId: offered.playerId,
          playerVersionId: offered.playerVersionId,
          slotIndex: 2,
        },
        { allowDisplacement: false },
      ),
    ).toThrow(/already occupied/);
  });
});

describe('replayDraftDuelLog', () => {
  function commandLogFor(
    rootSeed: Seed,
    catalog: DraftDuelCatalog,
    fairness: 'fair' | 'unfair',
  ): { commands: DraftDuelCommand[]; expected: DraftDuelDraft } {
    const commands: DraftDuelCommand[] = [];
    let state = createDraftDuelDraft({ rootSeed, fairness, catalog });
    let ordinal = 0;
    commands.push(
      draftDuelCommandSchema.parse({
        schemaVersion: 1,
        roomId: 'dd-room',
        commandId: `cmd-${String(ordinal)}`,
        ordinal,
        actorParticipantId: 'p1',
        payload: { kind: 'start' },
      }),
    );
    ordinal += 1;
    while (!isDraftDuelComplete(state)) {
      const pick = chooseFirstAvailable(state, catalog);
      commands.push(
        draftDuelCommandSchema.parse({
          schemaVersion: 1,
          roomId: 'dd-room',
          commandId: `cmd-${String(ordinal)}`,
          ordinal,
          actorParticipantId: pick.participantId,
          payload: {
            kind: 'pick',
            pickOrdinal: state.pickOrdinal,
            playerId: pick.playerId,
            playerVersionId: pick.playerVersionId,
            ...(pick.slotIndex === undefined ? {} : { slotIndex: pick.slotIndex }),
          },
        }),
      );
      ordinal += 1;
      state = applyDraftDuelPick(state, catalog, pick);
    }
    commands.push(
      draftDuelCommandSchema.parse({
        schemaVersion: 1,
        roomId: 'dd-room',
        commandId: 'cmd-ready',
        ordinal,
        actorParticipantId: 'p2',
        payload: { kind: 'ready', ready: true },
      }),
    );
    return { commands, expected: state };
  }

  it('replays a full pick log identically regardless of command order', () => {
    const catalog = buildCatalogFromSpecs(standardSpecs());
    const { commands, expected } = commandLogFor(SEED_A, catalog, 'fair');
    const replayed = replayDraftDuelLog({
      rootSeed: SEED_A,
      fairness: 'fair',
      catalog,
      commands,
    });
    expect(replayed).toEqual(expected);

    const shuffled = [...commands].reverse();
    const replayedFromShuffled = replayDraftDuelLog({
      rootSeed: SEED_A,
      fairness: 'fair',
      catalog,
      commands: shuffled,
    });
    expect(replayedFromShuffled).toEqual(expected);
  });

  it('ignores non-draft commands and rejects illegal picks by failing the replay', () => {
    const catalog = buildCatalogFromSpecs(standardSpecs());
    const { commands, expected } = commandLogFor(SEED_B, catalog, 'unfair');
    const withNoise: DraftDuelCommand[] = [
      ...commands,
      draftDuelCommandSchema.parse({
        schemaVersion: 1,
        roomId: 'dd-room',
        commandId: 'cmd-settings',
        ordinal: 100,
        actorParticipantId: 'p1',
        payload: { kind: 'settings', fairness: 'unfair', presentation: 'ratings' },
      }),
    ];
    expect(
      replayDraftDuelLog({ rootSeed: SEED_B, fairness: 'unfair', catalog, commands: withNoise }),
    ).toEqual(expected);
  });

  it('applies repositions only for reposition-aware multiplayer versions', () => {
    const catalog = buildCatalogFromSpecs(standardSpecs());
    let state = createDraftDuelDraft({ rootSeed: SEED_C, fairness: 'fair', catalog });
    const commands: DraftDuelCommand[] = [
      draftDuelCommandSchema.parse({
        schemaVersion: 1,
        roomId: 'dd-room',
        commandId: 'cmd-0',
        ordinal: 0,
        actorParticipantId: 'p1',
        payload: { kind: 'start' },
      }),
    ];
    let ordinal = 1;
    let reposition: { card: DraftDuelCard; slotIndex: number } | null = null;
    const actor = draftDuelCurrentPicker(state);
    while (reposition === null && state.status === 'drafting') {
      const picker = draftDuelCurrentPicker(state);
      const option = draftDuelLegalPicks(state, catalog).find(
        (entry) => entry.available && (entry.legalSlots?.length ?? 0) > 0,
      );
      if (!option) throw new Error('reposition replay fixture has no legal pick');
      const slotIndex = Math.min(...(option.legalSlots ?? []));
      commands.push(
        draftDuelCommandSchema.parse({
          schemaVersion: 1,
          roomId: 'dd-room',
          commandId: `cmd-${String(ordinal)}`,
          ordinal,
          actorParticipantId: picker,
          payload: {
            kind: 'pick',
            pickOrdinal: state.pickOrdinal,
            playerId: option.card.playerId,
            playerVersionId: option.card.playerVersionId,
            slotIndex,
          },
        }),
      );
      ordinal += 1;
      state = applyDraftDuelPick(state, catalog, pickInput(picker, option.card, slotIndex));
      for (const pick of state.rounds
        .flatMap((round) => round.picks)
        .filter((entry) => entry.participantId === actor)) {
        const slots = draftDuelRepositionSlots(state, catalog, actor, pick.card.playerVersionId);
        if (slots.length > 0) {
          reposition = { card: pick.card, slotIndex: slots[0] as number };
          break;
        }
      }
    }
    if (reposition === null) throw new Error('reposition replay fixture has no target');
    commands.push(
      draftDuelCommandSchema.parse({
        schemaVersion: 1,
        roomId: 'dd-room',
        commandId: `cmd-${String(ordinal)}`,
        ordinal,
        actorParticipantId: actor,
        payload: {
          kind: 'reposition',
          playerId: reposition.card.playerId,
          playerVersionId: reposition.card.playerVersionId,
          slotIndex: reposition.slotIndex,
        },
      }),
    );
    const modernExpected = repositionDraftDuelCard(state, catalog, {
      participantId: actor,
      playerVersionId: reposition.card.playerVersionId,
      slotIndex: reposition.slotIndex,
    });
    const modern = replayDraftDuelLog({
      rootSeed: SEED_C,
      fairness: 'fair',
      catalog,
      commands,
      multiplayerVersion: 'draft-duel-multiplayer-v2',
    });
    expect(modern.rounds).toEqual(modernExpected.rounds);
    expect(modern.pickOrdinal).toBe(modernExpected.pickOrdinal);
    const again = replayDraftDuelLog({
      rootSeed: SEED_C,
      fairness: 'fair',
      catalog,
      commands,
      multiplayerVersion: 'draft-duel-multiplayer-v2',
    });
    expect(again).toEqual(modern);
    const legacy = replayDraftDuelLog({
      rootSeed: SEED_C,
      fairness: 'fair',
      catalog,
      commands,
      multiplayerVersion: 'draft-duel-multiplayer-v1',
    });
    expect(legacy.rounds).toEqual(state.rounds);
    expect(legacy.pickOrdinal).toBe(state.pickOrdinal);
  });
});
