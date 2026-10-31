import type {
  CapRushMultiplayerMarket,
  CapRushMultiplayerMarketPlayer,
  CapRushSourcePlayer,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_BUCKET_RECIPE,
  CAP_RUSH_MULTIPLAYER_MARKET_SIZE,
  CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
  CAP_RUSH_MULTIPLAYER_MAX_GENERATION_ATTEMPTS,
  CAP_RUSH_MULTIPLAYER_POOL_SIZE,
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  POSITIONS,
  canonicalJson,
  capRushMultiplayerMarketBucketSeed,
  capRushMultiplayerMarketSchema,
  capRushMultiplayerMarketSeed,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { createRng, shuffle } from '../../../sim/rng.ts';
import type { CapRushCatalogIndex } from '../catalog.ts';
import { capRushSalaryDollars } from '../salary.ts';
import { capRushMultiplayerMinimumBidDollars } from './pricing.ts';
import { capRushMultiplayerCompletionFeasible } from './joint-feasibility.ts';

export class CapRushMultiplayerMarketError extends Error {
  readonly code = 'market-generation';
  readonly position: Position | null;
  constructor(position: Position | null, message: string) {
    super(message);
    this.name = 'CapRushMultiplayerMarketError';
    this.position = position;
  }
}

export class CapRushMultiplayerCompletionError extends Error {
  readonly code = 'completion-failed';
  readonly seat: string | null;
  constructor(seat: string | null, message: string) {
    super(message);
    this.name = 'CapRushMultiplayerCompletionError';
    this.seat = seat;
  }
}

function peakVersions(index: CapRushCatalogIndex): CapRushSourcePlayer[] {
  const peaks: CapRushSourcePlayer[] = [];
  for (const versions of index.byPlayerId.values()) {
    let best: CapRushSourcePlayer | null = null;
    for (const version of versions) {
      if (
        best === null ||
        version.originalOverall > best.originalOverall ||
        (version.originalOverall === best.originalOverall &&
          version.playerVersionId < best.playerVersionId)
      ) {
        best = version;
      }
    }
    if (best !== null) peaks.push(best);
  }
  peaks.sort((left, right) =>
    left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0,
  );
  return peaks;
}

function tryBuildAttempt(input: {
  readonly index: CapRushCatalogIndex;
  readonly rootSeed: Seed;
  readonly attempt: number;
  readonly peaks: readonly CapRushSourcePlayer[];
}): CapRushMultiplayerMarket | null {
  const used = new Set<string>();
  const players: CapRushMultiplayerMarketPlayer[] = [];
  for (const position of POSITIONS) {
    for (const rule of CAP_RUSH_MULTIPLAYER_BUCKET_RECIPE) {
      const candidates = input.peaks.filter(
        (player) =>
          !used.has(player.playerId) &&
          player.positions.includes(position) &&
          player.originalOverall >= rule.minOverall &&
          player.originalOverall <= rule.maxOverall,
      );
      if (candidates.length < rule.count) {
        return null;
      }
      const rng = createRng(
        capRushMultiplayerMarketBucketSeed(input.rootSeed, input.attempt, position, rule.bucket),
      );
      const picked = shuffle(candidates, rng).slice(0, rule.count);
      for (const player of picked) {
        used.add(player.playerId);
        players.push({
          playerId: player.playerId,
          playerVersionId: player.playerVersionId,
          displayName: player.displayName,
          position,
          bucket: rule.bucket,
          franchiseId: player.franchiseId,
          seasonKey: player.seasonKey,
          originalOverall: player.originalOverall,
          soloSalaryDollars: capRushSalaryDollars(player.originalOverall, player.seasonKey),
          minimumBidDollars: capRushMultiplayerMinimumBidDollars(
            player.originalOverall,
            player.seasonKey,
          ),
          source: player,
        });
      }
    }
  }
  if (players.length !== CAP_RUSH_MULTIPLAYER_MARKET_SIZE) return null;
  const affordable = capRushMultiplayerCompletionFeasible({
    players,
    unavailablePlayerIds: new Set(),
    seats: {
      p1: { committedDollars: 0, reservedDollars: 0, filledPositions: [] },
      p2: { committedDollars: 0, reservedDollars: 0, filledPositions: [] },
    },
  });
  if (!affordable) return null;
  const seed = capRushMultiplayerMarketSeed(input.rootSeed, input.attempt);
  const digest = seasonDigestHex(
    canonicalJson({
      version: CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
      seed,
      attempt: input.attempt,
      players: players.map((player) => ({
        playerId: player.playerId,
        playerVersionId: player.playerVersionId,
        position: player.position,
        bucket: player.bucket,
        minimumBidDollars: player.minimumBidDollars,
      })),
    }),
  );
  return {
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    version: CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
    seed,
    attempt: input.attempt,
    players,
    digest,
  };
}

export function buildCapRushMultiplayerMarket(input: {
  readonly index: CapRushCatalogIndex;
  readonly rootSeed: Seed;
}): CapRushMultiplayerMarket {
  const peaks = peakVersions(input.index);
  for (let attempt = 0; attempt < CAP_RUSH_MULTIPLAYER_MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const market = tryBuildAttempt({
      index: input.index,
      rootSeed: input.rootSeed,
      attempt,
      peaks,
    });
    if (market !== null) return capRushMultiplayerMarketSchema.parse(market);
  }
  throw new CapRushMultiplayerMarketError(
    null,
    `could not generate an affordable ${String(CAP_RUSH_MULTIPLAYER_POOL_SIZE * POSITIONS.length)}-player market in ${String(CAP_RUSH_MULTIPLAYER_MAX_GENERATION_ATTEMPTS)} attempts`,
  );
}

export function capRushMultiplayerMarketPlayerOf(
  market: CapRushMultiplayerMarket,
  playerId: string,
): CapRushMultiplayerMarketPlayer {
  const player = market.players.find((entry) => entry.playerId === playerId);
  if (player === undefined) {
    throw new CapRushMultiplayerMarketError(null, `market has no player ${playerId}`);
  }
  return player;
}
