import {
  COLLECTION_GAME_REWARD_LOSS_COINS,
  COLLECTION_GAME_REWARD_WIN_COINS,
  COLLECTION_REWARD_VERSION,
  canonicalJson,
  seasonDigestHex,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCpuRarityWeights,
  type CollectionGameEvent,
  type CollectionGameResult,
  type CollectionGameReward,
  type CollectionPreparedGame,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../sim/context.ts';
import { simulateSeasonGame, type RotationGameFact } from '../season/season-game.ts';
import { validateCollectionActiveTeam } from './active-team.ts';
import {
  COLLECTION_CPU_TEAM_ID,
  COLLECTION_PLAYER_TEAM_ID,
  toControllerInput,
} from './adapters.ts';
import { generateCollectionCpuTeam } from './cpu.ts';
import { collectionGameId, collectionGameSeed, collectionGameSeedPaths } from './seeds.ts';

export class CollectionGameError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function collectionPreparedInputDigest(
  prepared: Omit<CollectionPreparedGame, 'inputDigest'> & { inputDigest?: string },
): string {
  const { inputDigest: _ignored, ...rest } = prepared;
  void _ignored;
  return seasonDigestHex(canonicalJson(rest));
}

export function collectionGameResultDigest(result: CollectionGameResult): string {
  return seasonDigestHex(canonicalJson(result));
}

export function collectionGameEventDigest(events: readonly CollectionGameEvent[]): string {
  return seasonDigestHex(canonicalJson(events));
}

export function collectionGameRewardFor(
  result: Pick<CollectionGameResult, 'winner'>,
  gameId: string,
): CollectionGameReward {
  const win = result.winner === 'home';
  return {
    rewardVersion: COLLECTION_REWARD_VERSION,
    reason: win ? 'game-win-reward' : 'game-loss-reward',
    currency: 'Coins',
    amount: win ? COLLECTION_GAME_REWARD_WIN_COINS : COLLECTION_GAME_REWARD_LOSS_COINS,
    transactionId: `txn-${seasonDigestHex(
      ['collection-game-reward', gameId, COLLECTION_REWARD_VERSION].join('\u0000'),
    )}`,
  };
}

export function prepareCollectionBasicGame(input: {
  collectionId: string;
  rootSeed: string;
  gameSequence: number;
  ownedCardIds: ReadonlySet<string>;
  team: CollectionActiveTeam;
  catalog: CollectionCatalog;
  cpuWeights: CollectionCpuRarityWeights;
  profileVersion: string;
  profileHash: string;
  catalogHash: string;
  rulesHash: string;
}): CollectionPreparedGame {
  const resolve = (cardId: string) => input.catalog.cards.find((card) => card.cardId === cardId);
  const check = validateCollectionActiveTeam(input.team, resolve, input.ownedCardIds);
  if (!check.ok) {
    const first = check.issues[0];
    throw new CollectionGameError(
      first?.code ?? 'illegal-starters',
      first?.message ?? 'invalid active team',
    );
  }
  const cpu = generateCollectionCpuTeam(
    input.catalog,
    input.rootSeed,
    input.gameSequence,
    input.cpuWeights,
  );
  const seedPaths = collectionGameSeedPaths(input.gameSequence);
  const seed = collectionGameSeed(input.rootSeed, input.gameSequence);
  const gameId = collectionGameId(input.rootSeed, input.gameSequence);
  const prepared: CollectionPreparedGame = {
    gameVersion: 'collection-game-v1' as const,
    teamVersion: 'collection-team-v1' as const,
    rewardVersion: COLLECTION_REWARD_VERSION,
    replayVersion: 'collection-game-replay-v1' as const,
    rulesVersion: 'collection-game-rules-v1' as const,
    collectionId: input.collectionId as CollectionPreparedGame['collectionId'],
    gameId,
    gameSequence: input.gameSequence,
    rootSeed: input.rootSeed as CollectionPreparedGame['rootSeed'],
    seedPaths,
    seed: seed as CollectionPreparedGame['seed'],
    playerTeam: input.team,
    cpuTeam: cpu.team,
    environmentEraId: '2020s' as const,
    profileVersion: input.profileVersion,
    profileHash: input.profileHash as CollectionPreparedGame['profileHash'],
    catalogVersion: 'collection-catalog-v1' as const,
    catalogHash: input.catalogHash as CollectionPreparedGame['catalogHash'],
    rulesHash: input.rulesHash as CollectionPreparedGame['rulesHash'],
    homeCourtPolicy: 'neutral-home-court' as const,
    inputDigest: '0'.repeat(32),
  };
  return { ...prepared, inputDigest: collectionPreparedInputDigest(prepared) };
}

interface CollectedFacts {
  trips: Array<Extract<RotationGameFact, { kind: 'trip' }>>;
  exceptions: Array<Extract<RotationGameFact, { kind: 'foul-limit-exception' }>>;
}

function zeroBoxes() {
  return {
    points: 0,
    fieldGoalMakes: 0,
    fieldGoalAttempts: 0,
    threeMakes: 0,
    threeAttempts: 0,
    freeThrowMakes: 0,
    freeThrowAttempts: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  };
}

const BOX_KEYS = Object.keys(zeroBoxes()) as Array<keyof ReturnType<typeof zeroBoxes>>;

function diffBoxes(
  after: Record<string, number>,
  before: Record<string, number>,
): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const key of BOX_KEYS) {
    delta[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return delta;
}

function buildEvents(
  facts: CollectedFacts,
  result: Extract<CollectionGameResult, { outcome: 'completed' }>,
  homeRoster: readonly string[],
  awayRoster: readonly string[],
): CollectionGameEvent[] {
  const events: CollectionGameEvent[] = [];
  const trips = [...facts.trips].sort((a, b) => a.tripIndex - b.tripIndex);
  const subs = result.substitutions.map((sub, index) => ({ sub, index }));
  subs.sort((a, b) => {
    if (a.sub.period !== b.sub.period) return a.sub.period - b.sub.period;
    if (a.sub.secondsRemaining !== b.sub.secondsRemaining) {
      return b.sub.secondsRemaining - a.sub.secondsRemaining;
    }
    return a.index - b.index;
  });
  const emittedSubs = new Set<number>();
  const periodCount = result.home.periodScores.length;
  const pushSubstitution = (
    entry: (typeof subs)[number],
    homeScore: number,
    awayScore: number,
  ): void => {
    emittedSubs.add(entry.index);
    events.push({
      eventOrder: events.length,
      kind: 'substitution',
      period: entry.sub.period,
      secondsRemaining: entry.sub.secondsRemaining,
      homeScore,
      awayScore,
      side: entry.sub.side,
      playerInCardId: entry.sub.playerInCardId,
      playerOutCardId: entry.sub.playerOutCardId,
      reason: entry.sub.reason,
      unit: [...entry.sub.unit],
    });
  };

  for (let period = 1; period <= periodCount; period += 1) {
    const periodTrips = trips.filter((trip) => trip.period === period);
    for (let i = 0; i < periodTrips.length; i += 1) {
      const trip = periodTrips[i];
      if (trip === undefined) continue;
      const globalIndex = trips.indexOf(trip);
      const prev = globalIndex === 0 ? null : trips[globalIndex - 1];
      const homeBefore = prev?.homeScore ?? 0;
      const awayBefore = prev?.awayScore ?? 0;
      const offenseHome = trip.offenseSide === 'home';
      const pointsScored = offenseHome ? trip.homeScore - homeBefore : trip.awayScore - awayBefore;
      const statDeltas: Array<{
        side: 'home' | 'away';
        cardId: string;
        points: number;
        fieldGoalsMade: number;
        fieldGoalsAttempted: number;
        threePointMade: number;
        threePointAttempted: number;
        freeThrowMade: number;
        freeThrowAttempted: number;
        offensiveRebounds: number;
        defensiveRebounds: number;
        assists: number;
        steals: number;
        blocks: number;
        turnovers: number;
        fouls: number;
      }> = [];
      const participants = new Set<string>();
      const sides = [
        {
          key: 'home' as const,
          roster: homeRoster,
          before: prev?.homeBoxes,
          after: trip.homeBoxes,
        },
        {
          key: 'away' as const,
          roster: awayRoster,
          before: prev?.awayBoxes,
          after: trip.awayBoxes,
        },
      ];
      for (const side of sides) {
        for (let p = 0; p < side.roster.length; p += 1) {
          const cardId = side.roster[p];
          if (cardId === undefined) continue;
          const before = (side.before?.[p] ?? zeroBoxes()) as unknown as Record<string, number>;
          const after = (side.after[p] ?? zeroBoxes()) as unknown as Record<string, number>;
          const delta = diffBoxes(after, before);
          if (BOX_KEYS.every((key) => (delta[key] ?? 0) === 0)) continue;
          participants.add(cardId);
          statDeltas.push({
            side: side.key,
            cardId,
            points: delta['points'] ?? 0,
            fieldGoalsMade: delta['fieldGoalMakes'] ?? 0,
            fieldGoalsAttempted: delta['fieldGoalAttempts'] ?? 0,
            threePointMade: delta['threeMakes'] ?? 0,
            threePointAttempted: delta['threeAttempts'] ?? 0,
            freeThrowMade: delta['freeThrowMakes'] ?? 0,
            freeThrowAttempted: delta['freeThrowAttempts'] ?? 0,
            offensiveRebounds: delta['offensiveRebounds'] ?? 0,
            defensiveRebounds: delta['defensiveRebounds'] ?? 0,
            assists: delta['assists'] ?? 0,
            steals: delta['steals'] ?? 0,
            blocks: delta['blocks'] ?? 0,
            turnovers: delta['turnovers'] ?? 0,
            fouls: delta['fouls'] ?? 0,
          });
        }
      }
      const clockBefore = Math.floor(trip.clockBefore);
      const clockAfter = Math.max(0, Math.floor(trip.clockAfter));
      for (const entry of subs) {
        if (emittedSubs.has(entry.index)) continue;
        if (entry.sub.period !== trip.period) continue;
        if (entry.sub.secondsRemaining > clockBefore || entry.sub.secondsRemaining < clockAfter) {
          continue;
        }
        pushSubstitution(entry, homeBefore, awayBefore);
      }
      events.push({
        eventOrder: events.length,
        kind: 'possession',
        period: trip.period,
        secondsRemaining: Math.max(0, Math.floor(trip.clockAfter)),
        homeScore: trip.homeScore,
        awayScore: trip.awayScore,
        possessionNumber: trip.tripIndex + 1,
        offenseSide: trip.offenseSide,
        pointsScored,
        participantCardIds: [...participants].sort(),
        statDeltas,
      });
    }
    const periodHome = result.home.periodScores.slice(0, period).reduce((a, b) => a + b, 0);
    const periodAway = result.away.periodScores.slice(0, period).reduce((a, b) => a + b, 0);
    for (const entry of subs) {
      if (emittedSubs.has(entry.index)) continue;
      if (entry.sub.period !== period) continue;
      pushSubstitution(entry, periodHome, periodAway);
    }
    events.push({
      eventOrder: events.length,
      kind: 'period-end',
      period,
      secondsRemaining: 0,
      homeScore: periodHome,
      awayScore: periodAway,
      periodHomeScore: result.home.periodScores[period - 1] ?? 0,
      periodAwayScore: result.away.periodScores[period - 1] ?? 0,
    });
  }
  events.push({
    eventOrder: events.length,
    kind: 'final',
    period: periodCount,
    secondsRemaining: 0,
    homeScore: result.home.score,
    awayScore: result.away.score,
    winner: result.winner,
  });
  return events;
}

function mapCompletedResult(
  raw: unknown,
  prepared: CollectionPreparedGame,
  exceptions: CollectedFacts['exceptions'],
): Extract<CollectionGameResult, { outcome: 'completed' }> {
  const source = raw as {
    seed: string;
    engineVersion: string;
    profileVersion: string;
    winner: 'home' | 'away';
    overtimePeriods: number;
    home: {
      score: number;
      periodScores: number[];
      box: unknown;
      players: Array<Record<string, unknown> & { playerVersionId: string }>;
      shotZones: unknown;
    };
    away: {
      score: number;
      periodScores: number[];
      box: unknown;
      players: Array<Record<string, unknown> & { playerVersionId: string }>;
      shotZones: unknown;
    };
    substitutions: Array<
      Record<string, unknown> & {
        playerIn: string;
        playerOut: string;
        unit: string[];
      }
    >;
    unitStints: Array<Record<string, unknown> & { players: string[] }>;
    deviations: Array<Record<string, unknown> & { playerVersionId: string }>;
    foulOuts: Array<Record<string, unknown> & { playerVersionId: string }>;
  };
  const exceptionCards = new Set(exceptions.map((notice) => notice.participantId));
  const mapPlayer = (player: Record<string, unknown> & { playerVersionId: string }) => {
    const { playerVersionId, ...rest } = player;
    return { ...rest, cardId: playerVersionId };
  };
  const mapSide = (
    side: typeof source.home,
    teamId: string,
    displayName: string,
    sideKey: 'home' | 'away',
  ) => ({
    teamId,
    displayName,
    score: side.score,
    periodScores: [...side.periodScores],
    box: side.box,
    players: side.players.map(mapPlayer),
    shotZones: side.shotZones,
    foulLimitExceptions: exceptions
      .filter((notice) => notice.side === sideKey)
      .map((notice) => ({
        side: notice.side,
        cardId: notice.participantId,
        period: notice.period,
        secondsRemaining: notice.secondsRemaining,
      })),
  });
  return {
    gameVersion: 'collection-game-v1' as const,
    gameId: prepared.gameId,
    gameSequence: prepared.gameSequence,
    catalogVersion: 'collection-catalog-v1' as const,
    rulesVersion: 'collection-game-rules-v1' as const,
    engineVersion: source.engineVersion,
    profileVersion: source.profileVersion,
    winner: source.winner,
    outcome: 'completed' as const,
    overtimePeriods: source.overtimePeriods,
    home: mapSide(source.home, COLLECTION_PLAYER_TEAM_ID, 'Your Team', 'home'),
    away: mapSide(source.away, COLLECTION_CPU_TEAM_ID, 'CPU Team', 'away'),
    substitutions: source.substitutions.map((sub) => {
      const { playerIn, playerOut, unit, ...rest } = sub;
      return {
        ...rest,
        playerInCardId: playerIn,
        playerOutCardId: playerOut,
        unit: [...unit],
      };
    }),
    unitStints: source.unitStints.map((stint) => {
      const { players, ...rest } = stint;
      return { ...rest, players: [...players] };
    }),
    deviations: source.deviations.map((deviation) => {
      const { playerVersionId, ...rest } = deviation;
      const known = rest as { reasons?: unknown };
      const reasons = [...(Array.isArray(known.reasons) ? (known.reasons as string[]) : [])];
      if (exceptionCards.has(playerVersionId) && !reasons.includes('foul-limit-exception')) {
        reasons.push('foul-limit-exception');
      }
      return { ...rest, cardId: playerVersionId, reasons };
    }),
    foulOuts: source.foulOuts.map((foulOut) => {
      const { playerVersionId, ...rest } = foulOut;
      return { ...rest, cardId: playerVersionId };
    }),
  } as unknown as Extract<CollectionGameResult, { outcome: 'completed' }>;
}

export interface SimulatedCollectionGame {
  result: CollectionGameResult;
  events: CollectionGameEvent[];
}

export function simulateCollectionGame(
  prepared: CollectionPreparedGame,
  catalog: CollectionCatalog,
  profile: EraSimulationProfile,
): SimulatedCollectionGame {
  const expectedDigest = collectionPreparedInputDigest(prepared);
  if (expectedDigest !== prepared.inputDigest) {
    throw new CollectionGameError('invalid-result', 'prepared game input digest mismatch');
  }
  const input = toControllerInput(prepared, catalog, profile);
  const facts: RotationGameFact[] = [];
  const raw = simulateSeasonGame(input, createEngineContext(), {
    hooks: {
      minimumFiveFoulException: true,
      onGameFact: (fact) => {
        facts.push(fact);
      },
    },
  });
  if (raw.outcome === 'no-legal-five-both') {
    throw new CollectionGameError('no-legal-five', 'prepared game has no legal five at tipoff');
  }
  if (raw.outcome === 'forfeit') {
    const winner = raw.winner;
    const result: CollectionGameResult = {
      gameVersion: 'collection-game-v1' as const,
      gameId: prepared.gameId,
      gameSequence: prepared.gameSequence,
      catalogVersion: 'collection-catalog-v1' as const,
      rulesVersion: 'collection-game-rules-v1' as const,
      engineVersion: raw.engineVersion,
      profileVersion: raw.profileVersion,
      winner,
      outcome: 'forfeit' as const,
      losingTeamId: winner === 'home' ? COLLECTION_CPU_TEAM_ID : COLLECTION_PLAYER_TEAM_ID,
      trigger:
        raw.trigger === 'human-interruption-forfeit' ? 'no-legal-five-after-removal' : raw.trigger,
      homeScore: raw.homeScore,
      awayScore: raw.awayScore,
    };
    const events: CollectionGameEvent[] = [
      {
        eventOrder: 0,
        kind: 'final' as const,
        period: 1,
        secondsRemaining: 0,
        homeScore: raw.homeScore,
        awayScore: raw.awayScore,
        winner,
      },
    ];
    return { result, events };
  }
  const exceptions = facts.filter(
    (fact): fact is Extract<RotationGameFact, { kind: 'foul-limit-exception' }> =>
      fact.kind === 'foul-limit-exception',
  );
  const result = mapCompletedResult(raw, prepared, exceptions);
  const homeRoster = [...prepared.playerTeam.starters, ...prepared.playerTeam.bench];
  const awayRoster = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
  const events = buildEvents(
    {
      trips: facts.filter(
        (fact): fact is Extract<RotationGameFact, { kind: 'trip' }> => fact.kind === 'trip',
      ),
      exceptions,
    },
    result,
    homeRoster,
    awayRoster,
  );
  return { result, events };
}

export function reproduceCollectionGame(
  prepared: CollectionPreparedGame,
  catalog: CollectionCatalog,
  profile: EraSimulationProfile,
): SimulatedCollectionGame & { eventDigest: string; resultDigest: string } {
  const { result, events } = simulateCollectionGame(prepared, catalog, profile);
  return {
    result,
    events,
    eventDigest: collectionGameEventDigest(events),
    resultDigest: collectionGameResultDigest(result),
  };
}
