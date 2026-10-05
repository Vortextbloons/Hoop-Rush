import {
  COLLECTION_ACTIVE_TEAM_GAME_MINUTES,
  type CollectionDifficultyId,
  type CollectionDifficultyRotationPolicy,
} from '@hoop-rush/data-contracts';
import { CollectionCommandError } from './packs.ts';

export type CollectionMinuteStrategy = 'tight' | 'balanced' | 'deep';

export const COLLECTION_MINUTE_STRATEGIES: readonly CollectionMinuteStrategy[] = [
  'tight',
  'balanced',
  'deep',
];

export const COLLECTION_MINUTE_STARTER_TOTALS: Record<CollectionMinuteStrategy, number> = {
  tight: 185,
  balanced: 160,
  deep: 140,
};

export const COLLECTION_MINUTE_DNP_MIN_MINUTES = 4;
export const COLLECTION_MINUTE_DNP_OVERALL_GAP = 8;

export interface CollectionMinuteEntry {
  cardId: string;
  starter: boolean;
  overall: number;
  weight: number;
}

export interface CollectionMinutePlan {
  strategy: CollectionMinuteStrategy;
  targetMinutes: Array<{ cardId: string; minutes: number }>;
  starterTotal: number;
  quality: number;
  relief: number;
}

export function overallWeightOf(overall: number): number {
  return Math.max(1, overall);
}

export function policyWeightOf(
  overall: number,
  starter: boolean,
  policy: CollectionDifficultyRotationPolicy,
): number {
  const base = starter ? policy.starterWeightBp : policy.benchWeightBp;
  const bonus = Math.max(0, overall - policy.overallBonusFloor) * policy.overallBonusPerPointBp;
  return base + bonus;
}

export function strategyForDifficulty(
  difficultyId: CollectionDifficultyId,
): CollectionMinuteStrategy {
  switch (difficultyId) {
    case 'street':
      return 'deep';
    case 'pro':
      return 'balanced';
    case 'legend':
      return 'tight';
  }
}

function resolveGroupTotals(
  requestedStarterTotal: number,
  starterCount: number,
  benchCount: number,
  gameMinutes: number,
  cap: number,
): { starterTotal: number; benchTotal: number } {
  const starterCapacity = starterCount * cap;
  const benchCapacity = benchCount * cap;
  const maxStarter = Math.min(starterCapacity, gameMinutes);
  const minStarter = Math.max(starterCount, gameMinutes - benchCapacity);
  if (minStarter > maxStarter) {
    throw new CollectionCommandError(
      'invalid-minutes',
      `roster cannot fit ${String(gameMinutes)} minutes at cap ${String(cap)}`,
    );
  }
  let starterTotal = Math.min(Math.max(requestedStarterTotal, minStarter), maxStarter);
  let benchTotal = gameMinutes - starterTotal;
  if (benchTotal > benchCapacity) {
    benchTotal = benchCapacity;
    starterTotal = gameMinutes - benchTotal;
  }
  if (starterTotal > starterCapacity) {
    starterTotal = starterCapacity;
    benchTotal = gameMinutes - starterTotal;
  }
  if (
    starterTotal + benchTotal !== gameMinutes ||
    starterTotal > starterCapacity ||
    benchTotal > benchCapacity
  ) {
    throw new CollectionCommandError(
      'invalid-minutes',
      'failed to fit minute totals to roster caps',
    );
  }
  return { starterTotal, benchTotal };
}

function allocateGroup(
  entries: ReadonlyArray<{ cardId: string; weight: number }>,
  total: number,
  cap: number,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const entry of entries) result.set(entry.cardId, 0);
  if (entries.length === 0) {
    if (total !== 0) {
      throw new CollectionCommandError('invalid-minutes', 'minute group has no entries');
    }
    return result;
  }
  if (total === 0) return result;
  const weightSum = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (weightSum <= 0) {
    throw new CollectionCommandError('invalid-minutes', 'minute weights sum to zero');
  }
  let assigned = 0;
  const remainders: Array<{ cardId: string; frac: number }> = [];
  for (const entry of entries) {
    const raw = (total * Math.max(0, entry.weight)) / weightSum;
    const floor = Math.floor(raw);
    const headroom = Math.max(0, cap - (result.get(entry.cardId) ?? 0));
    const base = Math.min(headroom, floor);
    result.set(entry.cardId, (result.get(entry.cardId) ?? 0) + base);
    assigned += base;
    remainders.push({ cardId: entry.cardId, frac: raw - floor });
  }
  let leftover = total - assigned;
  const ordered = remainders.sort((a, b) =>
    b.frac !== a.frac ? b.frac - a.frac : a.cardId < b.cardId ? -1 : 1,
  );
  for (let guard = 0; guard < entries.length + 1 && leftover > 0; guard += 1) {
    let progressed = false;
    for (const entry of ordered) {
      if (leftover <= 0) break;
      if ((result.get(entry.cardId) ?? 0) >= cap) continue;
      result.set(entry.cardId, (result.get(entry.cardId) ?? 0) + 1);
      leftover -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  if (leftover !== 0) {
    throw new CollectionCommandError(
      'invalid-minutes',
      `minute group leaves ${String(leftover)} unassigned (cap ${String(cap)})`,
    );
  }
  return result;
}

function qualityOf(
  targetMinutes: ReadonlyArray<{ cardId: string; minutes: number }>,
  overallById: ReadonlyMap<string, number>,
): number {
  const total = targetMinutes.reduce((sum, row) => sum + row.minutes, 0);
  if (total <= 0) return 0;
  return (
    targetMinutes.reduce((sum, row) => sum + row.minutes * (overallById.get(row.cardId) ?? 0), 0) /
    total
  );
}

function reliefOf(
  targetMinutes: ReadonlyArray<{ cardId: string; minutes: number }>,
  benchIds: ReadonlySet<string>,
  overallById: ReadonlyMap<string, number>,
): number {
  const total = targetMinutes.reduce(
    (sum, row) => sum + row.minutes * (overallById.get(row.cardId) ?? 0),
    0,
  );
  if (total <= 0) return 0;
  const carried = targetMinutes.reduce(
    (sum, row) =>
      benchIds.has(row.cardId) ? sum + row.minutes * (overallById.get(row.cardId) ?? 0) : sum,
    0,
  );
  return Math.max(0, Math.min(1, carried / total));
}

function ensureStarterFloor(
  targetMinutes: Array<{ cardId: string; minutes: number }>,
  starterIds: ReadonlySet<string>,
): void {
  for (const row of targetMinutes) {
    if (!starterIds.has(row.cardId) || row.minutes >= 1) continue;
    const donors = targetMinutes
      .filter((candidate) => candidate.cardId !== row.cardId && candidate.minutes > 1)
      .sort((a, b) => b.minutes - a.minutes || (a.cardId < b.cardId ? -1 : 1));
    const donor = donors[0];
    if (donor === undefined) {
      throw new CollectionCommandError('invalid-minutes', `starter ${row.cardId} starved`);
    }
    donor.minutes -= 1;
    row.minutes += 1;
  }
}

export function planCollectionMinutes(
  entries: ReadonlyArray<CollectionMinuteEntry>,
  strategy: CollectionMinuteStrategy,
  maxMinutes: number,
): CollectionMinutePlan {
  const starters = entries.filter((entry) => entry.starter);
  const bench = entries.filter((entry) => !entry.starter);
  if (starters.length !== 5) {
    throw new CollectionCommandError(
      'invalid-minutes',
      `minute plan needs exactly 5 starters (got ${String(starters.length)})`,
    );
  }
  const { starterTotal, benchTotal } = resolveGroupTotals(
    COLLECTION_MINUTE_STARTER_TOTALS[strategy],
    starters.length,
    bench.length,
    COLLECTION_ACTIVE_TEAM_GAME_MINUTES,
    maxMinutes,
  );
  const starterMinutes = allocateGroup(
    starters.map((entry) => ({ cardId: entry.cardId, weight: entry.weight })),
    starterTotal,
    maxMinutes,
  );
  const benchMinutes = allocateGroup(
    bench.map((entry) => ({ cardId: entry.cardId, weight: entry.weight })),
    benchTotal,
    maxMinutes,
  );
  const targetMinutes = entries.map((entry) => ({
    cardId: entry.cardId,
    minutes: entry.starter
      ? (starterMinutes.get(entry.cardId) ?? 0)
      : (benchMinutes.get(entry.cardId) ?? 0),
  }));
  ensureStarterFloor(targetMinutes, new Set(starters.map((entry) => entry.cardId)));
  const total = targetMinutes.reduce((sum, row) => sum + row.minutes, 0);
  if (total !== COLLECTION_ACTIVE_TEAM_GAME_MINUTES) {
    throw new CollectionCommandError(
      'invalid-minutes',
      `minute plan totals ${String(total)} != ${String(COLLECTION_ACTIVE_TEAM_GAME_MINUTES)}`,
    );
  }
  const overallById = new Map(entries.map((entry) => [entry.cardId, entry.overall]));
  const benchIds = new Set(bench.map((entry) => entry.cardId));
  return {
    strategy,
    targetMinutes,
    starterTotal,
    quality: qualityOf(targetMinutes, overallById),
    relief: reliefOf(targetMinutes, benchIds, overallById),
  };
}

export function buildCollectionMinutePlans(
  entries: ReadonlyArray<CollectionMinuteEntry>,
  maxMinutes: number,
): CollectionMinutePlan[] {
  return COLLECTION_MINUTE_STRATEGIES.map((strategy) =>
    planCollectionMinutes(entries, strategy, maxMinutes),
  );
}

export function tryCollectionMinuteDnp(
  entries: ReadonlyArray<CollectionMinuteEntry>,
  plan: CollectionMinutePlan,
  maxMinutes: number,
): CollectionMinutePlan | null {
  const bench = entries.filter((entry) => !entry.starter);
  if (bench.length === 0) return null;
  const minutesById = new Map(plan.targetMinutes.map((row) => [row.cardId, row.minutes]));
  const ranked = [...bench].sort((a, b) => a.overall - b.overall || (a.cardId < b.cardId ? -1 : 1));
  const worst = ranked[0];
  if (worst === undefined) return null;
  const worstMinutes = minutesById.get(worst.cardId) ?? 0;
  if (worstMinutes <= COLLECTION_MINUTE_DNP_MIN_MINUTES) return null;
  const bestRemaining = Math.max(
    ...bench.filter((entry) => entry.cardId !== worst.cardId).map((entry) => entry.overall),
  );
  if (!(bestRemaining >= worst.overall + COLLECTION_MINUTE_DNP_OVERALL_GAP)) return null;
  const remaining = entries.filter((entry) => entry.cardId !== worst.cardId);
  const weightSum = remaining.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (weightSum <= 0) return null;
  let assigned = 0;
  const extras = new Map<string, number>();
  const remainders: Array<{ cardId: string; frac: number }> = [];
  for (const entry of remaining) {
    const raw = (worstMinutes * Math.max(0, entry.weight)) / weightSum;
    const floor = Math.floor(raw);
    extras.set(entry.cardId, floor);
    assigned += floor;
    remainders.push({ cardId: entry.cardId, frac: raw - floor });
  }
  remainders.sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.cardId < b.cardId ? -1 : 1));
  let leftover = worstMinutes - assigned;
  for (const entry of remainders) {
    if (leftover <= 0) break;
    extras.set(entry.cardId, (extras.get(entry.cardId) ?? 0) + 1);
    leftover -= 1;
  }
  const next = plan.targetMinutes.map((row) => {
    if (row.cardId === worst.cardId) return { cardId: row.cardId, minutes: 0 };
    const extra = extras.get(row.cardId) ?? 0;
    return { cardId: row.cardId, minutes: row.minutes + extra };
  });
  if (next.some((row) => row.minutes < 0 || row.minutes > maxMinutes)) return null;
  if (next.reduce((sum, row) => sum + row.minutes, 0) !== COLLECTION_ACTIVE_TEAM_GAME_MINUTES) {
    return null;
  }
  const overallById = new Map(entries.map((entry) => [entry.cardId, entry.overall]));
  const benchIds = new Set(bench.map((entry) => entry.cardId));
  return {
    strategy: plan.strategy,
    targetMinutes: next,
    starterTotal: next
      .filter((row) => entries.find((entry) => entry.cardId === row.cardId)?.starter === true)
      .reduce((sum, row) => sum + row.minutes, 0),
    quality: qualityOf(next, overallById),
    relief: reliefOf(next, benchIds, overallById),
  };
}
