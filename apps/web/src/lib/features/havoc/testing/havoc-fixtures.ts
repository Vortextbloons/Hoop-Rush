import {
  HAVOC_GAME_COUNT,
  HAVOC_MVP_INDEX_WEIGHTS,
  HAVOC_SCHEMA_VERSION,
  POSITIONS,
  eraIdSchema,
  franchiseIdSchema,
  havocCommandResultSchema,
  havocComparisonSchema,
  havocDraftStateSchema,
  havocGameResultSchema,
  havocGameTapeSchema,
  havocMatchedGameSchema,
  havocParticipantLineSchema,
  havocReportSchema,
  havocRunStateSchema,
  havocSlotComparisonSchema,
  playerIdSchema,
  seasonKeySchema,
  seedFromString,
} from '@hoop-rush/data-contracts';
import type {
  HavocCommandResult,
  HavocCommandRejectionCode,
  HavocComparison,
  HavocDraftCard,
  HavocDraftOffer,
  HavocDraftState,
  HavocGameResult,
  HavocGameSummary,
  HavocGameTape,
  HavocMatchedGame,
  HavocMutationEntry,
  HavocReport,
  HavocRunState,
  HavocSeasonTotals,
  HavocSlotComparison,
  HavocStatDelta,
  HavocStatLine,
  HavocTier,
  Position,
} from '@hoop-rush/data-contracts';
import type { HavocRunView } from '@hoop-rush/application/havoc';
import {
  buildHavocEffectiveProfile,
  buildHavocLockedInputs,
  buildHavocSourcePlayer,
  buildHavocStatLine,
  buildHavocVersionSet,
} from '@hoop-rush/test-fixtures';

export const RUN_ID = 'havoc-run-1';
export const OPPONENT_ID = 'opponent-a';
export const OPPONENT_NAME = 'Rival City Rockets';
export const HUMAN_TEAM_NAME = 'Hoop Havoc Five';

let hexCounter = 0;

export function fakeHex32(): string {
  hexCounter += 1;
  const chunk = (hexCounter + 4096).toString(16).padStart(4, '0');
  return (chunk.repeat(8) + '0'.repeat(32)).slice(0, 32);
}

export function instanceHex(index: number): string {
  return `hvi-${String(index).padStart(32, '0')}`;
}

export function requireAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`fake fixture is missing index ${String(index)}`);
  return value;
}

export function starterId(index: number): string {
  return FAKE_HUMAN_STARTER_IDS[index % FAKE_HUMAN_STARTER_IDS.length] ?? instanceHex(1);
}

export function replacementId(index: number): string {
  return FAKE_HUMAN_REPLACEMENT_IDS[index % FAKE_HUMAN_REPLACEMENT_IDS.length] ?? instanceHex(11);
}

export function cloneId(index: number): string {
  return FAKE_HUMAN_CLONE_IDS[index % FAKE_HUMAN_CLONE_IDS.length] ?? instanceHex(21);
}

export const FAKE_HUMAN_STARTER_IDS = [1, 2, 3, 4, 5].map(instanceHex);
export const FAKE_HUMAN_REPLACEMENT_IDS = [11, 12, 13, 14, 15].map(instanceHex);
export const FAKE_HUMAN_CLONE_IDS = [21, 22, 23, 24, 25].map(instanceHex);

export const HUMAN_STARTER_NAMES = [
  'Marcus Webb',
  'Deshawn Carter',
  'Nikola Petrov',
  'Andre Blake',
  'Tobias Grant',
];
export const HUMAN_REPLACEMENT_NAMES = [
  'Cory Miles',
  'Grant Ellis',
  'Pavel Novak',
  'Dorian Hayes',
  'Silas Ward',
];
export const OPPONENT_STARTER_NAMES = [
  'Cameron Vale',
  'Isaiah Frost',
  'Dante Cross',
  'Owen Marsh',
  'Victor Kane',
];
export const NICKNAMES = [
  'The Stretch',
  'Dunk Merchant',
  'Clone Lord',
  'Glass Cannon',
  'Time Bandit',
  'The Menace',
  'Rim Reaper',
  'Swat Machine',
  'The Problem',
  'Deep Freeze',
];

interface CardSpec {
  playerId: string;
  displayName: string;
  nickname: string;
  seasonKey: string;
  overall: number;
  tier: HavocTier;
  mutations: HavocMutationEntry[];
  heightInches: number | null;
}

export function specFor(
  slot: Position,
  round: number,
  offerIndex: number,
  cardIndex: number,
): CardSpec {
  const seedIndex = round * 10 + cardIndex + offerIndex;
  const tier = ([1, 2, 3] as const)[cardIndex] ?? 1;
  const names = [
    HUMAN_STARTER_NAMES[(seedIndex + cardIndex) % HUMAN_STARTER_NAMES.length] ?? 'Marcus Webb',
    HUMAN_REPLACEMENT_NAMES[(seedIndex + cardIndex + 1) % HUMAN_REPLACEMENT_NAMES.length] ??
      'Cory Miles',
    OPPONENT_STARTER_NAMES[(seedIndex + cardIndex + 2) % OPPONENT_STARTER_NAMES.length] ??
      'Cameron Vale',
  ];
  const displayName = names[cardIndex] ?? 'Fixture Player';
  const mutations: HavocMutationEntry[] =
    tier === 1
      ? [
          { mutationId: 'growth-spurt', sampledHeightDelta: 6 + cardIndex },
          { mutationId: 'super-soldier' },
          { mutationId: 'point-god' },
        ]
      : tier === 2
        ? [{ mutationId: 'four-point-dunk' }, { mutationId: 'trigger-happy' }]
        : [{ mutationId: 'clone-army' }];
  return {
    playerId: `p-havoc-${slot.toLowerCase()}-${String(round)}-${String(cardIndex)}-${String(offerIndex)}`,
    displayName,
    nickname: NICKNAMES[(seedIndex + cardIndex) % NICKNAMES.length] ?? 'The Problem',
    seasonKey: `199${String(round + 2)}-9${String((round + cardIndex) % 10)}`,
    overall: 74 + cardIndex * 4 + round,
    tier,
    mutations,
    heightInches: cardIndex === 2 && round === 1 ? null : 74 + cardIndex * 2,
  };
}

export function effectiveFor(
  source: ReturnType<typeof buildHavocSourcePlayer>,
  mutations: HavocMutationEntry[],
) {
  const base = buildHavocEffectiveProfile(source);
  const ratings = { ...base.ratings };
  const tendencies = { ...base.tendencies };
  let height = base.physical.heightInches;
  let wingspanDelta = base.physical.wingspanDeltaInches;
  for (const entry of mutations) {
    switch (entry.mutationId) {
      case 'growth-spurt':
        height += entry.sampledHeightDelta ?? 8;
        break;
      case 'super-soldier':
        ratings.speed = 90;
        ratings.strength = 90;
        ratings.vertical = 90;
        break;
      case 'point-god':
        ratings.passing = 99;
        ratings.ballHandling = 99;
        tendencies.passRate = 85;
        break;
      case 'sniper-gene':
        ratings.threePoint = 97;
        tendencies.threePointRate = 80;
        break;
      case 'trigger-happy':
        ratings.insideScoring = 99;
        ratings.closeShot = 99;
        ratings.midrange = 99;
        ratings.threePoint = 99;
        ratings.freeThrow = 99;
        tendencies.shotRate = 99;
        tendencies.usageRate = 45;
        tendencies.passRate = 2;
        break;
      case 'alien-arms':
        wingspanDelta += 18;
        break;
      default:
        break;
    }
  }
  return {
    ...base,
    ratings,
    tendencies,
    physical: { ...base.physical, heightInches: height, wingspanDeltaInches: wingspanDelta },
  };
}

export function makeCard(input: {
  runSeed: string;
  round: number;
  offerIndex: number;
  slot: Position;
  cardIndex: number;
  offerId: string;
}): HavocDraftCard {
  const spec = specFor(input.slot, input.round, input.offerIndex, input.cardIndex);
  const source = buildHavocSourcePlayer({
    playerId: playerIdSchema.parse(spec.playerId),
    playerVersionId: `pv-${fakeHex32()}`,
    displayName: spec.displayName,
    franchiseId: franchiseIdSchema.parse('lakers'),
    eraId: eraIdSchema.parse('1990s'),
    seasonKey: seasonKeySchema.parse(spec.seasonKey),
    positions: [input.slot],
    originalOverall: spec.overall,
    physical: { heightInches: spec.heightInches, weightLbs: 205 + input.cardIndex * 10 },
  });
  return {
    cardId: `hvc-${fakeHex32()}`,
    offerId: input.offerId,
    cardIndex: input.cardIndex,
    slot: input.slot,
    tier: spec.tier,
    source,
    mutations: spec.mutations,
    effective: effectiveFor(source, spec.mutations),
    nickname: spec.nickname,
  };
}

export function buildOffer(input: {
  runSeed: string;
  round: number;
  slot: Position;
  offerIndex: number;
}): HavocDraftOffer {
  const offerId = `hvo-${fakeHex32()}`;
  const cards = [0, 1, 2].map((cardIndex) => makeCard({ ...input, cardIndex, offerId }));
  return { offerId, offerIndex: input.offerIndex, round: input.round, slot: input.slot, cards };
}

export function makeDraftState(runSeed: string, runId = RUN_ID): HavocDraftState {
  const offer = buildOffer({ runSeed, round: 1, slot: 'PG', offerIndex: 0 });
  return havocDraftStateSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    runId,
    revision: 0,
    runSeed,
    versionSet: buildHavocVersionSet(),
    catalog: {
      catalogVersion: 'season-draft-catalog-v4',
      catalogHash: 'a'.repeat(64),
      dataVersion: 'data-v1',
      ratingsVersion: 'ratings-v5.3',
      playerVersionIdVersion: 'player-version-id-v1',
      positionNormalizationVersion: 'position-v4',
    },
    round: 1,
    slot: 'PG',
    offerId: offer.offerId,
    offerIndex: 0,
    cards: offer.cards,
    rerollUsed: false,
    picks: [],
    status: 'drafting',
  });
}

export function makeDraftRunState(runId = RUN_ID): HavocRunState {
  const runSeed = seedFromString('havoc-fake-run-seed');
  return havocRunStateSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    runId,
    revision: 0,
    runSeed,
    versionSet: buildHavocVersionSet(),
    phase: 'draft',
    draft: makeDraftState(runSeed, runId),
    locked: null,
    havocCursor: 0,
    normalCursor: 0,
    havocAggregate: {
      games: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      adjustments: 0,
    },
    normalAggregate: {
      games: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      adjustments: 0,
    },
    perfectSeason: false,
    comparisonStatus: 'not-started',
    completionState: 'draft',
  });
}

export function lockedFromDraft(state: HavocRunState, draft: HavocDraftState) {
  const base = buildHavocLockedInputs({ picks: draft.picks });
  return {
    ...base,
    runId: state.runId,
    runSeed: state.runSeed,
    versionSet: state.versionSet,
    human: { ...base.human, displayName: HUMAN_TEAM_NAME },
    opponents: [
      {
        opponentId: OPPONENT_ID,
        team: { ...requireAt(base.opponents, 0).team, displayName: OPPONENT_NAME },
      },
    ],
  };
}

export function toRunView(state: HavocRunState): HavocRunView {
  const locked = state.locked;
  const lineup = (locked?.picks ?? []).map((pick) => ({
    slot: pick.slot,
    displayName: pick.card.source.displayName,
    nickname: pick.card.nickname,
    playerVersionId: pick.card.source.playerVersionId,
    tier: pick.card.tier,
    overall: pick.card.source.originalOverall,
    mutations: pick.card.mutations,
  }));
  const scheduleEntry =
    locked === null
      ? undefined
      : locked.schedule[Math.min(state.havocCursor, HAVOC_GAME_COUNT - 1)];
  const opponent =
    locked === null || scheduleEntry === undefined
      ? undefined
      : locked.opponents.find((entry) => entry.opponentId === scheduleEntry.opponentId);
  return {
    runId: state.runId,
    revision: state.revision,
    phase: state.phase,
    havocCursor: state.havocCursor,
    normalCursor: state.normalCursor,
    havocWins: state.havocAggregate.wins,
    havocLosses: state.havocAggregate.losses,
    normalWins: state.normalAggregate.wins,
    normalLosses: state.normalAggregate.losses,
    perfectSeason: state.perfectSeason,
    comparisonStatus: state.comparisonStatus,
    completionState: state.completionState,
    lineup,
    nextGameNumber: state.havocCursor < HAVOC_GAME_COUNT ? state.havocCursor + 1 : null,
    nextOpponentDisplayName: opponent?.team.displayName ?? null,
    nextHumanHome: scheduleEntry?.humanHome ?? null,
  };
}

export function commandResult(input: {
  runId: string;
  revisionBefore: number;
  revisionAfter: number;
  rejection?: { code: HavocCommandRejectionCode; message: string };
}): HavocCommandResult {
  return havocCommandResultSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-${fakeHex32()}`,
    runId: input.runId,
    status: input.rejection === undefined ? 'accepted' : 'rejected',
    revisionBefore: input.revisionBefore,
    revisionAfter: input.revisionAfter,
    stateDigest: fakeHex32(),
    rejection:
      input.rejection === undefined
        ? null
        : { code: input.rejection.code, message: input.rejection.message },
  });
}

export function rejected(
  runId: string,
  revision: number,
  code: HavocCommandRejectionCode,
  message: string,
): HavocCommandResult {
  return commandResult({
    runId,
    revisionBefore: revision,
    revisionAfter: revision,
    rejection: { code, message },
  });
}

export function buildFakeGameResult(summary: HavocGameSummary): HavocGameResult {
  const human = humanTeamParticipants();
  const opponent = opponentTeamParticipants();
  const distribute = (total: number): number[] => {
    const base = Math.trunc(total / 5);
    return [base, base, base, base, total - base * 4];
  };
  const humanPoints = distribute(summary.humanScore);
  const opponentPoints = distribute(summary.opponentScore);
  const humanWithPoints = human.map((participant, index) => ({
    ...participant,
    points: humanPoints[index] ?? 0,
    adjustments: summary.adjustments,
  }));
  const opponentWithPoints = opponent.map((participant, index) => ({
    ...participant,
    points: opponentPoints[index] ?? 0,
  }));
  const humanTeam = {
    side: summary.humanSide,
    teamId: 'human-team',
    displayName: HUMAN_TEAM_NAME,
    points: summary.humanScore,
    teamBonusPoints: 0,
    fieldGoals: { made: 38, attempted: 84 },
    threes: { made: 11, attempted: 30 },
    freeThrows: { made: 14, attempted: 18 },
    rebounds: { total: 42, offensive: 9, defensive: 33, team: 3 },
    assists: 24,
    steals: 8,
    blocks: 4,
    turnovers: 12,
    fouls: 18,
    adjustments: summary.adjustments,
    periods: summary.periods.human,
    courtSeconds: 5 * 48 * 60,
    participants: humanWithPoints,
  };
  const opponentTeam = {
    side: summary.humanSide === 'home' ? ('away' as const) : ('home' as const),
    teamId: 'opponent-team',
    displayName: OPPONENT_NAME,
    points: summary.opponentScore,
    teamBonusPoints: 0,
    fieldGoals: { made: 35, attempted: 80 },
    threes: { made: 9, attempted: 26 },
    freeThrows: { made: 13, attempted: 17 },
    rebounds: { total: 40, offensive: 10, defensive: 30, team: 2 },
    assists: 21,
    steals: 6,
    blocks: 3,
    turnovers: 14,
    fouls: 20,
    adjustments: 0,
    periods: summary.periods.opponent,
    courtSeconds: 5 * 48 * 60,
    participants: opponentWithPoints,
  };
  return havocGameResultSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber: summary.gameNumber,
    variant: summary.variant,
    seed: summary.seed,
    engineVersion: 'm3-engine-v24',
    rulesVersion: 'havoc-rules-v5',
    mutationCatalogVersion: 'havoc-mutations-v5',
    profileVersion: 'm2-2010s-fixture-v1',
    dataVersion: 'data-v1',
    humanSide: summary.humanSide,
    home: summary.humanSide === 'home' ? humanTeam : opponentTeam,
    away: summary.humanSide === 'home' ? opponentTeam : humanTeam,
    winner:
      summary.humanScore > summary.opponentScore
        ? summary.humanSide
        : summary.humanSide === 'home'
          ? 'away'
          : 'home',
    overtimePeriods: summary.overtimePeriods,
    inputDigest: summary.inputDigest,
    rollups: [],
    highlights: [],
  });
}

export function buildFakeTape(summary: HavocGameSummary): HavocGameTape {
  type TapeChunk = { kind: 'field-goal'; nominal: 2 | 3 } | { kind: 'free-throw'; nominal: 1 };
  const events: HavocGameTape['events'] = [];
  const scoring: HavocGameTape['scoring'] = [];
  let eventSequence = 0;
  let scoringSequence = 0;
  const chunksFor = (total: number): TapeChunk[] => {
    const chunks: TapeChunk[] = [];
    let remaining = Math.max(0, total);
    while (remaining >= 4) {
      chunks.push({ nominal: 3, kind: 'field-goal' });
      remaining -= 3;
    }
    if (remaining === 3) chunks.push({ nominal: 3, kind: 'field-goal' });
    else if (remaining === 2) chunks.push({ nominal: 2, kind: 'field-goal' });
    else if (remaining === 1) chunks.push({ nominal: 1, kind: 'free-throw' });
    return chunks;
  };
  const humanChunks = chunksFor(summary.humanScore);
  const opponentChunks = chunksFor(summary.opponentScore);
  const total = humanChunks.length + opponentChunks.length;
  for (let period = 1; period <= 4; period += 1) {
    events.push({
      kind: 'period-start',
      sequence: eventSequence,
      gameNumber: summary.gameNumber,
      period,
      clockSeconds: 720,
    });
    eventSequence += 1;
  }
  const pushChunk = (chunk: TapeChunk, side: HavocSide, ordinal: number): void => {
    const period = Math.min(4, Math.floor((ordinal * 4) / Math.max(1, total)) + 1);
    const clockSeconds = Math.max(
      0,
      Math.floor(720 - (((ordinal * 720) / Math.max(1, total)) % 720)),
    );
    const instanceId = side === 'human' ? starterId(ordinal % 5) : instanceHex(31 + (ordinal % 5));
    if (chunk.kind === 'field-goal') {
      events.push({
        kind: 'shot-attempt',
        sequence: eventSequence,
        gameNumber: summary.gameNumber,
        period,
        clockSeconds,
        possessionId: ordinal,
        shooterInstanceId: instanceId,
        side,
        zone: 'rim',
        shotKind: chunk.nominal === 3 ? 'jumper' : 'layup',
        made: true,
        nominalPoints: chunk.nominal,
      });
      eventSequence += 1;
      events.push({
        kind: 'assist',
        sequence: eventSequence,
        gameNumber: summary.gameNumber,
        period,
        clockSeconds,
        possessionId: ordinal,
        assisterInstanceId:
          side === 'human' ? starterId((ordinal + 1) % 5) : instanceHex(31 + ((ordinal + 1) % 5)),
        scorerInstanceId: instanceId,
        side,
      });
      eventSequence += 1;
    } else {
      events.push({
        kind: 'free-throw-attempt',
        sequence: eventSequence,
        gameNumber: summary.gameNumber,
        period,
        clockSeconds,
        possessionId: ordinal,
        shooterInstanceId: instanceId,
        side,
        made: true,
        bonus: false,
      });
      eventSequence += 1;
    }
    scoring.push({
      sequence: scoringSequence,
      gameNumber: summary.gameNumber,
      period,
      clockSeconds,
      possessionId: ordinal,
      side,
      kind: chunk.kind,
      actorInstanceId: instanceId,
      beneficiaryInstanceId: null,
      nominalPoints: chunk.nominal,
      addends: [],
      multipliers: [],
      points: chunk.nominal,
      owners: [],
      originalEventSequence: null,
    });
    scoringSequence += 1;
  };
  let ordinal = 0;
  let humanIndex = 0;
  let opponentIndex = 0;
  while (humanIndex < humanChunks.length || opponentIndex < opponentChunks.length) {
    const takeHuman =
      ordinal % 2 === 0 ? humanIndex < humanChunks.length : opponentIndex >= opponentChunks.length;
    if (takeHuman) {
      pushChunk(requireAt(humanChunks, humanIndex), 'human', ordinal);
      humanIndex += 1;
    } else {
      pushChunk(requireAt(opponentChunks, opponentIndex), 'opponent', ordinal);
      opponentIndex += 1;
    }
    ordinal += 1;
  }
  const homeScore = summary.humanSide === 'home' ? summary.humanScore : summary.opponentScore;
  const awayScore = summary.humanSide === 'home' ? summary.opponentScore : summary.humanScore;
  events.push({
    kind: 'game-end',
    sequence: eventSequence,
    gameNumber: summary.gameNumber,
    period: 4,
    clockSeconds: 0,
    homeScore,
    awayScore,
    winner: homeScore > awayScore ? 'home' : 'away',
  });
  return havocGameTapeSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber: summary.gameNumber,
    variant: summary.variant,
    seed: summary.seed,
    events,
    scoring,
  });
}

type HavocSide = 'human' | 'opponent';

export function buildNegativeScoreTape(gameNumber = 1): HavocGameTape {
  const events: HavocGameTape['events'] = [];
  const scoring: HavocGameTape['scoring'] = [];
  let eventSequence = 0;
  let scoringSequence = 0;
  const push = (entry: {
    period: number;
    clockSeconds: number;
    side: HavocSide;
    points: number;
    nominal: number;
    actorIndex: number;
  }): void => {
    const instanceId =
      entry.side === 'human' ? starterId(entry.actorIndex) : instanceHex(31 + entry.actorIndex);
    events.push({
      kind: 'shot-attempt',
      sequence: eventSequence,
      gameNumber,
      period: entry.period,
      clockSeconds: entry.clockSeconds,
      possessionId: scoringSequence,
      shooterInstanceId: instanceId,
      side: entry.side,
      zone: 'aboveBreakThree',
      shotKind: 'jumper',
      made: entry.points > 0,
      nominalPoints: entry.nominal === 3 ? 3 : 2,
    });
    eventSequence += 1;
    scoring.push({
      sequence: scoringSequence,
      gameNumber,
      period: entry.period,
      clockSeconds: entry.clockSeconds,
      possessionId: scoringSequence,
      side: entry.side,
      kind: 'field-goal',
      actorInstanceId: instanceId,
      beneficiaryInstanceId: null,
      nominalPoints: entry.points > 0 ? (entry.nominal === 3 ? 3 : 2) : 0,
      addends: [],
      multipliers: [],
      points: entry.points,
      owners: [],
      originalEventSequence: null,
    });
    scoringSequence += 1;
  };
  push({ period: 1, clockSeconds: 640, side: 'human', points: 2, nominal: 2, actorIndex: 0 });
  push({ period: 1, clockSeconds: 500, side: 'opponent', points: 3, nominal: 3, actorIndex: 0 });
  for (let index = 0; index < 5; index += 1) {
    const period = index < 3 ? 1 : 2;
    const clockSeconds = 400 - index * 40;
    const instanceId = starterId(index % 5);
    events.push({
      kind: 'shot-attempt',
      sequence: eventSequence,
      gameNumber,
      period,
      clockSeconds,
      possessionId: scoringSequence,
      shooterInstanceId: instanceId,
      side: 'human',
      zone: 'longMid',
      shotKind: 'jumper',
      made: false,
      nominalPoints: 2,
    });
    eventSequence += 1;
    scoring.push({
      sequence: scoringSequence,
      gameNumber,
      period,
      clockSeconds,
      possessionId: scoringSequence,
      side: 'human',
      kind: 'adjustment',
      actorInstanceId: instanceId,
      beneficiaryInstanceId: null,
      nominalPoints: -1,
      addends: [{ source: 'double-or-nothing', points: -1 }],
      multipliers: [],
      points: -1,
      owners: [],
      originalEventSequence: null,
    });
    scoringSequence += 1;
  }
  events.push({
    kind: 'game-end',
    sequence: eventSequence,
    gameNumber,
    period: 4,
    clockSeconds: 0,
    homeScore: -3,
    awayScore: 3,
    winner: 'away',
  });
  return havocGameTapeSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber,
    variant: 'havoc',
    seed: seedFromString(`havoc-fake-negative-${String(gameNumber)}`),
    events,
    scoring,
  });
}

export function buildMutationTape(gameNumber = 1): HavocGameTape {
  const events: HavocGameTape['events'] = [];
  const scoring: HavocGameTape['scoring'] = [];
  let eventSequence = 0;
  let scoringSequence = 0;
  const shooter = starterId(0);
  events.push({
    kind: 'shot-attempt',
    sequence: eventSequence,
    gameNumber,
    period: 1,
    clockSeconds: 700,
    possessionId: 1,
    shooterInstanceId: shooter,
    side: 'human',
    zone: 'rim',
    shotKind: 'dunk',
    made: true,
    nominalPoints: 2,
  });
  eventSequence += 1;
  events.push({
    kind: 'four-point-dunk',
    sequence: eventSequence,
    gameNumber,
    period: 1,
    clockSeconds: 700,
    shooterInstanceId: shooter,
    side: 'human',
    scoringSequence: 0,
  });
  eventSequence += 1;
  scoring.push({
    sequence: scoringSequence,
    gameNumber,
    period: 1,
    clockSeconds: 700,
    possessionId: 1,
    side: 'human',
    kind: 'field-goal',
    actorInstanceId: shooter,
    beneficiaryInstanceId: null,
    nominalPoints: 2,
    addends: [{ source: 'four-point-dunk', points: 1 }],
    multipliers: [],
    points: 3,
    owners: [],
    originalEventSequence: null,
  });
  scoringSequence += 1;
  events.push({
    kind: 'heat-check',
    sequence: eventSequence,
    gameNumber,
    period: 1,
    clockSeconds: 690,
    outcome: 'armed',
    ownerInstanceId: shooter,
    side: 'human',
    scoringSequence: null,
  });
  eventSequence += 1;
  events.push({
    kind: 'turnover',
    sequence: eventSequence,
    gameNumber,
    period: 1,
    clockSeconds: 640,
    possessionId: 2,
    playerInstanceId: shooter,
    side: 'human',
  });
  eventSequence += 1;
  events.push({
    kind: 'turnover-cancelled',
    sequence: eventSequence,
    gameNumber,
    period: 1,
    clockSeconds: 640,
    possessionId: 2,
    playerInstanceId: shooter,
    side: 'human',
    originalSequence: eventSequence - 1,
  });
  eventSequence += 1;
  events.push({
    kind: 'roulette',
    sequence: eventSequence,
    gameNumber,
    period: 1,
    clockSeconds: 520,
    ownerInstanceId: starterId(1),
    side: 'human',
    attemptOrdinal: 7,
    rolled: 4,
    nominal: 3,
    scoringSequence: 1,
  });
  eventSequence += 1;
  scoring.push({
    sequence: scoringSequence,
    gameNumber,
    period: 1,
    clockSeconds: 520,
    possessionId: 3,
    side: 'human',
    kind: 'field-goal',
    actorInstanceId: starterId(1),
    beneficiaryInstanceId: null,
    nominalPoints: 3,
    addends: [{ source: 'roulette', points: 1 }],
    multipliers: [],
    points: 4,
    owners: [],
    originalEventSequence: null,
  });
  scoringSequence += 1;
  events.push({
    kind: 'game-end',
    sequence: eventSequence,
    gameNumber,
    period: 4,
    clockSeconds: 0,
    homeScore: 7,
    awayScore: 6,
    winner: 'home',
  });
  return havocGameTapeSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber,
    variant: 'havoc',
    seed: seedFromString(`havoc-fake-mutation-${String(gameNumber)}`),
    events,
    scoring,
  });
}

export function buildCloneGameResult(gameNumber = 1): HavocGameResult {
  const starterIds = FAKE_HUMAN_STARTER_IDS;
  const replacementInstanceId = replacementId(2);
  const cloneInstanceId = cloneId(0);
  const humanParticipants = [
    ...starterIds.map((instanceId, index) => ({
      instanceId,
      kind: 'starter' as const,
      slot: POSITIONS[index] ?? 'PG',
      ownerInstanceId: null,
      sourcePlayerId: `p-havoc-human-${String(index + 1)}`,
      sourcePlayerVersionId: `pv-${'1'.repeat(32)}`,
      displayName: HUMAN_STARTER_NAMES[index] ?? 'Marcus Webb',
      ...buildHavocStatLine({
        points: index === 0 ? 18 : 8,
        rebounds: { total: 5, offensive: 1, defensive: 4 },
        assists: 4,
        fouls: index === 2 ? 6 : 2,
        chargedFouls: index === 2 ? 6 : 2,
      }),
    })),
    {
      instanceId: replacementInstanceId,
      kind: 'replacement' as const,
      slot: 'SF',
      ownerInstanceId: requireAt(starterIds, 2),
      sourcePlayerId: 'p-havoc-human-3',
      sourcePlayerVersionId: `pv-${'1'.repeat(32)}`,
      displayName: HUMAN_REPLACEMENT_NAMES[2] ?? 'Pavel Novak',
      ...buildHavocStatLine({
        points: 6,
        rebounds: { total: 3, offensive: 0, defensive: 3 },
        assists: 1,
        fouls: 2,
        chargedFouls: 2,
      }),
    },
    {
      instanceId: cloneInstanceId,
      kind: 'clone' as const,
      slot: 'PG',
      ownerInstanceId: requireAt(starterIds, 0),
      sourcePlayerId: 'p-havoc-human-1',
      sourcePlayerVersionId: `pv-${'1'.repeat(32)}`,
      displayName: `${HUMAN_STARTER_NAMES[0] ?? 'Marcus Webb'} (Clone)`,
      ...buildHavocStatLine({
        points: 12,
        rebounds: { total: 4, offensive: 2, defensive: 2 },
        assists: 3,
        steals: 2,
        blocks: 1,
        fouls: 3,
        chargedFouls: 3,
      }),
    },
  ];
  const opponentParticipants = OPPONENT_STARTER_NAMES.map((displayName, index) => ({
    instanceId: instanceHex(31 + index),
    kind: 'starter' as const,
    slot: POSITIONS[index] ?? 'PG',
    ownerInstanceId: null,
    sourcePlayerId: `p-havoc-opponent-${String(index + 1)}`,
    sourcePlayerVersionId: null,
    displayName,
    ...buildHavocStatLine({
      points: 14 - index,
      rebounds: { total: 4, offensive: 1, defensive: 3 },
    }),
  }));
  const humanPoints = humanParticipants.reduce(
    (total, participant) => total + participant.points,
    0,
  );
  const opponentPoints = opponentParticipants.reduce(
    (total, participant) => total + participant.points,
    0,
  );
  const humanTeam = {
    side: 'home' as const,
    teamId: 'human-team',
    displayName: HUMAN_TEAM_NAME,
    points: humanPoints,
    teamBonusPoints: 0,
    fieldGoals: { made: 40, attempted: 86 },
    threes: { made: 12, attempted: 31 },
    freeThrows: { made: 15, attempted: 19 },
    rebounds: { total: 44, offensive: 10, defensive: 34, team: 3 },
    assists: 26,
    steals: 9,
    blocks: 5,
    turnovers: 11,
    fouls: 22,
    adjustments: 8,
    periods: splitPeriods(humanPoints),
    courtSeconds: 5 * 48 * 60 + 620,
    participants: humanParticipants,
  };
  const opponentTeam = {
    side: 'away' as const,
    teamId: 'opponent-team',
    displayName: OPPONENT_NAME,
    points: opponentPoints,
    teamBonusPoints: 0,
    fieldGoals: { made: 36, attempted: 82 },
    threes: { made: 9, attempted: 25 },
    freeThrows: { made: 13, attempted: 16 },
    rebounds: { total: 39, offensive: 9, defensive: 30, team: 2 },
    assists: 20,
    steals: 5,
    blocks: 3,
    turnovers: 15,
    fouls: 19,
    adjustments: 0,
    periods: splitPeriods(opponentPoints),
    courtSeconds: 5 * 48 * 60,
    participants: opponentParticipants,
  };
  return havocGameResultSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber,
    variant: 'havoc',
    seed: seedFromString(`havoc-fake-clone-${String(gameNumber)}`),
    engineVersion: 'm3-engine-v24',
    rulesVersion: 'havoc-rules-v5',
    mutationCatalogVersion: 'havoc-mutations-v5',
    profileVersion: 'm2-2010s-fixture-v1',
    dataVersion: 'data-v1',
    humanSide: 'home',
    home: humanTeam,
    away: opponentTeam,
    winner: 'home',
    overtimePeriods: 0,
    inputDigest: fakeHex32(),
    rollups: [
      {
        ownerInstanceId: starterId(0),
        mutationId: 'clone-army',
        side: 'human',
        triggers: 1,
        pointsDelta: 12,
        freeThrowsGranted: 0,
        turnoversCancelled: 0,
        extraPossessionsEarned: 0,
        extraPossessionsUsed: 0,
        extraPossessionsExpired: 0,
        swapSeconds: 0,
        capSeconds: 0,
        activeSeconds: 620,
        ratingChanges: 0,
      },
      {
        ownerInstanceId: starterId(1),
        mutationId: 'four-point-dunk',
        side: 'human',
        triggers: 3,
        pointsDelta: 6,
        freeThrowsGranted: 0,
        turnoversCancelled: 0,
        extraPossessionsEarned: 0,
        extraPossessionsUsed: 0,
        extraPossessionsExpired: 0,
        swapSeconds: 0,
        capSeconds: 0,
        activeSeconds: 2880,
        ratingChanges: 0,
      },
    ],
    highlights: [
      {
        kind: 'foul-out',
        period: 3,
        clockSeconds: 420,
        instanceId: starterId(2),
        mutationId: null,
        pointsDelta: 0,
      },
    ],
  });
}

export function buildFakeComparison(runId = RUN_ID): HavocComparison {
  const games: HavocMatchedGame[] = Array.from({ length: HAVOC_GAME_COUNT }, (_, index) => {
    const gameNumber = index + 1;
    const havocWin = gameNumber % 3 !== 0;
    const havocHuman = 100 + (gameNumber % 7);
    const havocOpponent = havocWin ? havocHuman - 5 : havocHuman + 6;
    const normalWin = gameNumber % 4 !== 0;
    const normalHuman = 98 + (gameNumber % 5);
    const normalOpponent = normalWin ? normalHuman - 7 : normalHuman + 7;
    return havocMatchedGameSchema.parse({
      gameNumber,
      opponentId: OPPONENT_ID,
      humanHome: gameNumber % 2 === 1,
      havoc: {
        humanScore: havocHuman,
        opponentScore: havocOpponent,
        outcome: havocWin ? 'win' : 'loss',
        resultDigest: fakeHex32(),
      },
      normal: {
        humanScore: normalHuman,
        opponentScore: normalOpponent,
        outcome: normalWin ? 'win' : 'loss',
        resultDigest: fakeHex32(),
      },
      deltas: {
        pointsFor: havocHuman - normalHuman,
        pointsAgainst: havocOpponent - normalOpponent,
        margin: havocHuman - havocOpponent - (normalHuman - normalOpponent),
      },
      flips: {
        havocWinNormalLoss: havocWin && !normalWin,
        normalWinHavocLoss: normalWin && !havocWin,
      },
      highlights:
        gameNumber === 1
          ? [
              {
                kind: 'mutation',
                period: 2,
                clockSeconds: 420,
                instanceId: starterId(0),
                mutationId: 'four-point-dunk',
                pointsDelta: 2,
              },
            ]
          : [],
    });
  });
  const havocTotals = totalsFromGames(games, 'havoc');
  const normalTotals = totalsFromGames(games, 'normal');
  const slots = buildFakeSlots();
  const mvpSlot = slots.reduce((best, slot) =>
    slot.productionIndex.gain > best.productionIndex.gain ? slot : best,
  );
  const mutations = [
    {
      mutationId: 'four-point-dunk' as const,
      ownerCount: 1,
      triggers: 41,
      pointsDelta: 82,
      freeThrowsGranted: 0,
      turnoversCancelled: 0,
      extraPossessionsEarned: 0,
      extraPossessionsUsed: 0,
      extraPossessionsExpired: 0,
      swapSeconds: 0,
      capSeconds: 0,
      ratingChanges: 0,
    },
    {
      mutationId: 'possession-refund' as const,
      ownerCount: 1,
      triggers: 6,
      pointsDelta: 0,
      freeThrowsGranted: 0,
      turnoversCancelled: 6,
      extraPossessionsEarned: 0,
      extraPossessionsUsed: 0,
      extraPossessionsExpired: 0,
      swapSeconds: 0,
      capSeconds: 0,
      ratingChanges: 0,
    },
    {
      mutationId: 'clone-army' as const,
      ownerCount: 1,
      triggers: 82,
      pointsDelta: 214,
      freeThrowsGranted: 0,
      turnoversCancelled: 0,
      extraPossessionsEarned: 0,
      extraPossessionsUsed: 0,
      extraPossessionsExpired: 0,
      swapSeconds: 0,
      capSeconds: 0,
      ratingChanges: 0,
    },
  ];
  const differences = games
    .map((game) => ({
      gameNumber: game.gameNumber,
      opponentId: game.opponentId,
      humanScore: game.havoc.humanScore,
      opponentScore: game.havoc.opponentScore,
      pointsDelta: game.deltas.margin,
      outcome: game.havoc.outcome,
    }))
    .sort((a, b) => b.pointsDelta - a.pointsDelta);
  return havocComparisonSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    comparisonVersion: 'havoc-comparison-v1',
    mvpIndexVersion: 'havoc-mvp-index-v1',
    runId,
    havoc: havocTotals,
    normal: normalTotals,
    winsGained: havocTotals.wins - normalTotals.wins,
    differentialDelta: havocTotals.differential - normalTotals.differential,
    games,
    slots,
    mutations,
    mvp: {
      slot: mvpSlot.slot,
      playerId: mvpSlot.playerId,
      playerVersionId: mvpSlot.playerVersionId,
      displayName: mvpSlot.displayName,
      havocIndex: mvpSlot.productionIndex.havoc,
      normalIndex: mvpSlot.productionIndex.normal,
      gain: mvpSlot.productionIndex.gain,
    },
    mvpIndexWeights: { ...HAVOC_MVP_INDEX_WEIGHTS },
    largestPositiveDifferences: differences.slice(0, 5),
    largestNegativeDifferences: differences.slice(-5).reverse(),
  });
}

function totalsFromGames(
  games: readonly HavocMatchedGame[],
  variant: 'havoc' | 'normal',
): HavocSeasonTotals {
  const humanScores = games.map((game) => game[variant].humanScore);
  const opponentScores = games.map((game) => game[variant].opponentScore);
  const wins = games.filter((game) => game[variant].outcome === 'win').length;
  const pointsFor = humanScores.reduce((total, score) => total + score, 0);
  const pointsAgainst = opponentScores.reduce((total, score) => total + score, 0);
  return {
    games: games.length,
    wins,
    losses: games.length - wins,
    pointsFor,
    pointsAgainst,
    differential: pointsFor - pointsAgainst,
    averagePointsFor: pointsFor / games.length,
    averagePointsAgainst: pointsAgainst / games.length,
    largestPointsFor: Math.max(...humanScores),
    largestPointsAgainst: Math.max(...opponentScores),
    adjustments: variant === 'havoc' ? 214 : 0,
  };
}

export function totalsFromAggregate(aggregate: HavocRunState['havocAggregate']): HavocSeasonTotals {
  const games = Math.max(1, aggregate.games);
  return {
    games: aggregate.games,
    wins: aggregate.wins,
    losses: aggregate.losses,
    pointsFor: aggregate.pointsFor,
    pointsAgainst: aggregate.pointsAgainst,
    differential: aggregate.pointsFor - aggregate.pointsAgainst,
    averagePointsFor: aggregate.pointsFor / games,
    averagePointsAgainst: aggregate.pointsAgainst / games,
    largestPointsFor: aggregate.games === 0 ? 0 : 112,
    largestPointsAgainst: aggregate.games === 0 ? 0 : 108,
    adjustments: aggregate.adjustments,
  };
}

function sumStatLines(lines: readonly HavocStatLine[]): HavocStatLine {
  const total = buildHavocStatLine({
    secondsPlayed: 0,
    minutes: 0,
    points: 0,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    chargedFouls: 0,
    adjustments: 0,
  });
  for (const line of lines) {
    total.secondsPlayed += line.secondsPlayed;
    total.minutes += line.minutes;
    total.points += line.points;
    total.fieldGoals.made += line.fieldGoals.made;
    total.fieldGoals.attempted += line.fieldGoals.attempted;
    total.threes.made += line.threes.made;
    total.threes.attempted += line.threes.attempted;
    total.freeThrows.made += line.freeThrows.made;
    total.freeThrows.attempted += line.freeThrows.attempted;
    total.rebounds.total += line.rebounds.total;
    total.rebounds.offensive += line.rebounds.offensive;
    total.rebounds.defensive += line.rebounds.defensive;
    total.assists += line.assists;
    total.steals += line.steals;
    total.blocks += line.blocks;
    total.turnovers += line.turnovers;
    total.fouls += line.fouls;
    total.chargedFouls += line.chargedFouls;
    total.adjustments += line.adjustments;
  }
  return total;
}

function havocMvpIndexOf(line: HavocStatLine): number {
  return (
    HAVOC_MVP_INDEX_WEIGHTS.points * line.points +
    HAVOC_MVP_INDEX_WEIGHTS.rebounds * line.rebounds.total +
    HAVOC_MVP_INDEX_WEIGHTS.assists * line.assists +
    HAVOC_MVP_INDEX_WEIGHTS.steals * line.steals +
    HAVOC_MVP_INDEX_WEIGHTS.blocks * line.blocks +
    HAVOC_MVP_INDEX_WEIGHTS.turnovers * line.turnovers
  );
}

function statDeltaOf(havoc: HavocStatLine, normal: HavocStatLine): HavocStatDelta {
  return {
    secondsPlayed: havoc.secondsPlayed - normal.secondsPlayed,
    minutes: havoc.minutes - normal.minutes,
    points: havoc.points - normal.points,
    fieldGoalsMade: havoc.fieldGoals.made - normal.fieldGoals.made,
    fieldGoalAttempts: havoc.fieldGoals.attempted - normal.fieldGoals.attempted,
    threesMade: havoc.threes.made - normal.threes.made,
    threesAttempted: havoc.threes.attempted - normal.threes.attempted,
    freeThrowsMade: havoc.freeThrows.made - normal.freeThrows.made,
    freeThrowsAttempted: havoc.freeThrows.attempted - normal.freeThrows.attempted,
    rebounds: havoc.rebounds.total - normal.rebounds.total,
    offensiveRebounds: havoc.rebounds.offensive - normal.rebounds.offensive,
    defensiveRebounds: havoc.rebounds.defensive - normal.rebounds.defensive,
    assists: havoc.assists - normal.assists,
    steals: havoc.steals - normal.steals,
    blocks: havoc.blocks - normal.blocks,
    turnovers: havoc.turnovers - normal.turnovers,
    fouls: havoc.fouls - normal.fouls,
    adjustments: havoc.adjustments - normal.adjustments,
    productionIndex: havocMvpIndexOf(havoc) - havocMvpIndexOf(normal),
  };
}

function buildFakeSlots(): HavocSlotComparison[] {
  const slotNames = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  return slotNames.map((slot, index) => {
    const havocStarter = buildHavocStatLine({
      points: 22 - index * 2,
      rebounds: { total: 6 - index, offensive: 1, defensive: 5 - index },
      assists: 7 - index,
      steals: 2,
      blocks: index,
      turnovers: 3,
      fouls: 2,
      adjustments: index,
    });
    const havocLines: HavocSlotComparison['havoc']['lines'] = [
      {
        kind: 'starter',
        instanceId: starterId(index),
        displayName: HUMAN_STARTER_NAMES[index] ?? 'Marcus Webb',
        line: havocStarter,
      },
    ];
    if (index === 0) {
      havocLines.push({
        kind: 'clone',
        instanceId: cloneId(0),
        displayName: `${HUMAN_STARTER_NAMES[0] ?? 'Marcus Webb'} (Clone)`,
        line: buildHavocStatLine({
          points: 10,
          rebounds: { total: 4, offensive: 2, defensive: 2 },
          assists: 3,
          steals: 1,
          blocks: 1,
          turnovers: 2,
          fouls: 3,
        }),
      });
    }
    if (index === 2) {
      havocLines.push({
        kind: 'replacement',
        instanceId: replacementId(2),
        displayName: HUMAN_REPLACEMENT_NAMES[2] ?? 'Pavel Novak',
        line: buildHavocStatLine({
          points: 5,
          rebounds: { total: 2, offensive: 0, defensive: 2 },
          assists: 1,
          steals: 0,
          blocks: 0,
          turnovers: 1,
          fouls: 2,
        }),
      });
    }
    const normalStarter = buildHavocStatLine({
      points: 17 - index * 2,
      rebounds: { total: 5 - index, offensive: 1, defensive: 4 - index },
      assists: 5 - index,
      steals: 1,
      blocks: Math.max(0, index - 1),
      turnovers: 3,
      fouls: 2,
      adjustments: 0,
    });
    const havocCombined = sumStatLines(havocLines.map((entry) => entry.line));
    const normalCombined = normalStarter;
    return havocSlotComparisonSchema.parse({
      slot,
      displayName: HUMAN_STARTER_NAMES[index] ?? 'Marcus Webb',
      playerId: `p-havoc-slot-${String(index + 1)}`,
      playerVersionId: `pv-${'2'.repeat(32)}`,
      havoc: { combined: havocCombined, lines: havocLines },
      normal: {
        combined: normalCombined,
        lines: [
          {
            kind: 'starter',
            instanceId: starterId(index),
            displayName: HUMAN_STARTER_NAMES[index] ?? 'Marcus Webb',
            line: normalStarter,
          },
        ],
      },
      deltas: statDeltaOf(havocCombined, normalCombined),
      productionIndex: {
        havoc: havocMvpIndexOf(havocCombined),
        normal: havocMvpIndexOf(normalCombined),
        gain: havocMvpIndexOf(havocCombined) - havocMvpIndexOf(normalCombined),
      },
    });
  });
}

export function buildFakeReport(
  runId = RUN_ID,
  comparison: HavocComparison | null = null,
  havocTotalsOverride?: HavocSeasonTotals,
): HavocReport {
  const havocTotals = comparison?.havoc ??
    havocTotalsOverride ?? {
      games: 82,
      wins: 55,
      losses: 27,
      pointsFor: 8321,
      pointsAgainst: 8110,
      differential: 211,
      averagePointsFor: 101.5,
      averagePointsAgainst: 98.9,
      largestPointsFor: 128,
      largestPointsAgainst: 122,
      adjustments: 214,
    };
  const wildestGames =
    comparison === null
      ? []
      : [...comparison.games]
          .sort(
            (a, b) =>
              Math.abs(a.deltas.margin) - Math.abs(b.deltas.margin) || a.gameNumber - b.gameNumber,
          )
          .slice(0, 5)
          .map((game) => ({
            gameNumber: game.gameNumber,
            opponentId: game.opponentId,
            humanScore: game.havoc.humanScore,
            opponentScore: game.havoc.opponentScore,
            adjustments: game.gameNumber % 5,
            absoluteMargin: Math.abs(game.havoc.humanScore - game.havoc.opponentScore),
          }));
  return havocReportSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    reportVersion: 'havoc-report-v1',
    runId,
    versions: buildHavocVersionSet(),
    status: comparison === null ? 'comparison-pending' : 'complete',
    lineup: (['PG', 'SG', 'SF', 'PF', 'C'] as const).map((slot, index) => ({
      slot,
      displayName: HUMAN_STARTER_NAMES[index] ?? 'Marcus Webb',
      nickname: NICKNAMES[index] ?? 'The Problem',
      playerId: `p-havoc-slot-${String(index + 1)}`,
      playerVersionId: `pv-${'2'.repeat(32)}`,
      tier: ((index % 3) + 1) as HavocTier,
      mutations: [
        index === 0
          ? { mutationId: 'growth-spurt' as const, sampledHeightDelta: 8 }
          : index === 1
            ? { mutationId: 'four-point-dunk' as const }
            : index === 2
              ? { mutationId: 'clone-army' as const }
              : index === 3
                ? { mutationId: 'possession-refund' as const }
                : { mutationId: 'super-soldier' as const },
      ],
    })),
    havoc: havocTotals,
    normal: comparison?.normal ?? null,
    perfectSeason: havocTotals.losses === 0 && havocTotals.games === HAVOC_GAME_COUNT,
    directMutationPoints:
      comparison === null
        ? 0
        : comparison.mutations.reduce((total, entry) => total + entry.pointsDelta, 0),
    mvp: comparison?.mvp ?? null,
    comparison,
    topGains: comparison?.largestPositiveDifferences ?? [],
    topLosses: comparison?.largestNegativeDifferences ?? [],
    wildestGames,
  });
}

export function buildPendingComparisonRunState(input: {
  havocCursor?: number;
  normalCursor?: number;
  havocWins?: number;
  havocLosses?: number;
}): HavocRunState {
  const base = makeLockedRunState();
  const havocCursor = input.havocCursor ?? HAVOC_GAME_COUNT;
  const havocWins = input.havocWins ?? 55;
  const havocLosses = input.havocLosses ?? 27;
  return havocRunStateSchema.parse({
    ...base,
    havocCursor,
    havocAggregate: {
      games: havocCursor,
      wins: havocWins,
      losses: havocLosses,
      pointsFor: 101 * havocCursor,
      pointsAgainst: 99 * havocCursor,
      adjustments: 3 * havocCursor,
    },
    normalCursor: input.normalCursor ?? 0,
    normalAggregate: (() => {
      const games = input.normalCursor ?? 0;
      const wins = Math.floor(games * 0.6);
      return {
        games,
        wins,
        losses: games - wins,
        pointsFor: 99 * games,
        pointsAgainst: 101 * games,
        adjustments: 0,
      };
    })(),
    perfectSeason: havocCursor === HAVOC_GAME_COUNT && havocLosses === 0,
    comparisonStatus: (input.normalCursor ?? 0) > 0 ? 'running' : 'not-started',
    completionState: 'season',
  });
}

export function buildCompleteRunState(): HavocRunState {
  const base = makeLockedRunState();
  return havocRunStateSchema.parse({
    ...base,
    havocCursor: HAVOC_GAME_COUNT,
    havocAggregate: {
      games: HAVOC_GAME_COUNT,
      wins: 55,
      losses: 27,
      pointsFor: 8321,
      pointsAgainst: 8110,
      adjustments: 214,
    },
    normalCursor: HAVOC_GAME_COUNT,
    normalAggregate: {
      games: HAVOC_GAME_COUNT,
      wins: 50,
      losses: 32,
      pointsFor: 8100,
      pointsAgainst: 8050,
      adjustments: 0,
    },
    perfectSeason: false,
    comparisonStatus: 'complete',
    completionState: 'complete',
  });
}

export function makeLockedRunState(runId = RUN_ID): HavocRunState {
  const draftState = makeDraftRunState(runId);
  const draft = draftState.draft;
  if (draft === null) throw new Error('fake draft state missing');
  const picks = (['PG', 'SG', 'SF', 'PF', 'C'] as const).map((slot, index) => {
    const offer = buildOffer({
      runSeed: draftState.runSeed,
      round: index + 1,
      slot,
      offerIndex: 0,
    });
    const card = offer.cards[0];
    if (card === undefined) throw new Error('fake offer missing card');
    return {
      pickOrdinal: index,
      slot,
      claimKey: { playerId: card.source.playerId, seasonKey: card.source.seasonKey ?? '1996-97' },
      card,
    };
  });
  const completedDraft = havocDraftStateSchema.parse({ ...draft, picks, status: 'complete' });
  return havocRunStateSchema.parse({
    ...draftState,
    phase: 'run',
    draft: null,
    locked: lockedFromDraft(draftState, completedDraft),
    completionState: 'season',
  });
}

export function splitPeriods(total: number): number[] {
  const base = Math.trunc(total / 4);
  return [base, base, base, total - base * 3];
}

export function foldAggregate(
  aggregate: HavocRunState['havocAggregate'],
  summary: HavocGameSummary,
): HavocRunState['havocAggregate'] {
  return {
    games: aggregate.games + 1,
    wins: aggregate.wins + (summary.outcome === 'win' ? 1 : 0),
    losses: aggregate.losses + (summary.outcome === 'loss' ? 1 : 0),
    pointsFor: aggregate.pointsFor + summary.humanScore,
    pointsAgainst: aggregate.pointsAgainst + summary.opponentScore,
    adjustments: aggregate.adjustments + summary.adjustments,
  };
}

export function humanTeamParticipants(): HavocGameResult['home']['participants'] {
  return FAKE_HUMAN_STARTER_IDS.map((instanceId, index) =>
    havocParticipantLineSchema.parse({
      instanceId,
      kind: 'starter',
      slot: POSITIONS[index] ?? 'PG',
      ownerInstanceId: null,
      sourcePlayerId: `p-havoc-human-${String(index + 1)}`,
      sourcePlayerVersionId: `pv-${'1'.repeat(32)}`,
      displayName: HUMAN_STARTER_NAMES[index] ?? 'Marcus Webb',
      ...buildHavocStatLine(),
    }),
  );
}

export function opponentTeamParticipants(): HavocGameResult['away']['participants'] {
  return OPPONENT_STARTER_NAMES.map((displayName, index) =>
    havocParticipantLineSchema.parse({
      instanceId: instanceHex(31 + index),
      kind: 'starter',
      slot: POSITIONS[index] ?? 'PG',
      ownerInstanceId: null,
      sourcePlayerId: `p-havoc-opponent-${String(index + 1)}`,
      sourcePlayerVersionId: null,
      displayName,
      ...buildHavocStatLine(),
    }),
  );
}
