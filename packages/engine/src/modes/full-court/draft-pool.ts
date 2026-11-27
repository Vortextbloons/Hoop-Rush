import type {
  CapRushSourcePlayer,
  FullCourtDraftPool,
  FullCourtMoneyConfig,
  PlayerId,
  Position,
} from '@hoop-rush/data-contracts';
import {
  FULL_COURT_MIN_ROSTER_SIZE,
  FULL_COURT_POOL_TARGET_SIZE,
  FULL_COURT_POOL_VERSION,
  POSITIONS,
  fullCourtDraftPoolSchema,
} from '@hoop-rush/data-contracts';
import { compareStrings } from '../../domain/math.ts';
import { createRng, shuffle, type Rng } from '../../sim/rng.ts';
import {
  fullCourtCheapestPeople,
  fullCourtSalaryDollarsOf,
  type FullCourtCatalogIndex,
} from './draft-catalog.ts';

type OvrTier = 'star' | 'starter' | 'rotation' | 'budget';

const TIER_QUOTA_RATIOS: Readonly<Record<OvrTier, number>> = {
  star: 10 / 75,
  starter: 20 / 75,
  rotation: 25 / 75,
  budget: 20 / 75,
};

const OPENING_TIER_CYCLE: readonly OvrTier[] = [
  'star',
  'starter',
  'rotation',
  'budget',
  'starter',
  'rotation',
];

function ovrTierOf(overall: number): OvrTier {
  if (overall >= 85) return 'star';
  if (overall >= 76) return 'starter';
  if (overall >= 68) return 'rotation';
  return 'budget';
}

function tierQuotasFor(targetSize: number): Record<OvrTier, number> {
  const star = Math.round(targetSize * TIER_QUOTA_RATIOS.star);
  const starter = Math.round(targetSize * TIER_QUOTA_RATIOS.starter);
  const rotation = Math.round(targetSize * TIER_QUOTA_RATIOS.rotation);
  const budget = Math.max(0, targetSize - star - starter - rotation);
  return { star, starter, rotation, budget };
}

function groupDistinctPlayers(
  index: FullCourtCatalogIndex,
): ReadonlyArray<readonly CapRushSourcePlayer[]> {
  const byPlayerId = new Map<PlayerId, CapRushSourcePlayer[]>();
  for (const candidate of index.catalog.candidates) {
    const list = byPlayerId.get(candidate.playerId);
    if (list === undefined) {
      byPlayerId.set(candidate.playerId, [candidate]);
    } else {
      list.push(candidate);
    }
  }
  const groups: CapRushSourcePlayer[][] = [];
  for (const [, versions] of [...byPlayerId.entries()].sort((a, b) => compareStrings(a[0], b[0]))) {
    versions.sort((a, b) => compareStrings(a.playerVersionId, b.playerVersionId));
    groups.push(versions);
  }
  return groups;
}

function ensurePoolAffordability(
  selected: CapRushSourcePlayer[],
  index: FullCourtCatalogIndex,
  money: FullCourtMoneyConfig,
  franchiseStar: CapRushSourcePlayer | null,
): CapRushSourcePlayer[] {
  const budgetCap = Math.min(money.hardLimitDollars, money.startingWarChestDollars);
  const pool = [...selected];

  const minimumPayroll = (items: readonly CapRushSourcePlayer[]): number => {
    const openPlaces = FULL_COURT_MIN_ROSTER_SIZE - (franchiseStar === null ? 0 : 1);
    const salaries = items
      .filter((player) => player.playerId !== franchiseStar?.playerId)
      .map((player) => fullCourtSalaryDollarsOf(player))
      .sort((a, b) => a - b);
    const remaining = salaries.slice(0, openPlaces).reduce((sum, salary) => sum + salary, 0);
    return remaining + (franchiseStar === null ? 0 : fullCourtSalaryDollarsOf(franchiseStar));
  };

  if (minimumPayroll(pool) <= budgetCap) return pool;

  const selectedPlayerIds = new Set(pool.map((player) => player.playerId));
  for (const cheapest of fullCourtCheapestPeople(index)) {
    if (minimumPayroll(pool) <= budgetCap) break;
    const candidate = index.byVersionId.get(cheapest.playerVersionId);
    if (candidate === undefined) continue;

    if (selectedPlayerIds.has(cheapest.playerId)) {
      if (cheapest.playerId === franchiseStar?.playerId) continue;
      const existingIndex = pool.findIndex((entry) => entry.playerId === cheapest.playerId);
      const existing = pool[existingIndex];
      if (existing !== undefined && cheapest.salaryDollars < fullCourtSalaryDollarsOf(existing)) {
        pool[existingIndex] = candidate;
      }
      continue;
    }

    // Keep the franchise star while making room for a legal roster around them.
    let maxIndex = -1;
    let maxSalary = -1;
    for (const [i, entry] of pool.entries()) {
      if (entry.playerId === franchiseStar?.playerId) continue;
      const salary = fullCourtSalaryDollarsOf(entry);
      if (salary > maxSalary) {
        maxSalary = salary;
        maxIndex = i;
      }
    }
    const replaced = pool[maxIndex];
    if (replaced === undefined || maxSalary <= cheapest.salaryDollars) break;
    selectedPlayerIds.delete(replaced.playerId);
    pool[maxIndex] = candidate;
    selectedPlayerIds.add(candidate.playerId);
  }

  return pool;
}

function mixCuratedOpeningOrder(
  selected: readonly CapRushSourcePlayer[],
  franchiseStar: CapRushSourcePlayer | null,
  rng: Rng,
): CapRushSourcePlayer[] {
  const byTier: Record<OvrTier, CapRushSourcePlayer[]> = {
    star: [],
    starter: [],
    rotation: [],
    budget: [],
  };
  for (const player of selected) {
    if (player.playerId === franchiseStar?.playerId) continue;
    byTier[ovrTierOf(player.originalOverall)].push(player);
  }
  const queues: Record<OvrTier, CapRushSourcePlayer[]> = {
    star: shuffle(byTier.star, rng),
    starter: shuffle(byTier.starter, rng),
    rotation: shuffle(byTier.rotation, rng),
    budget: shuffle(byTier.budget, rng),
  };
  if (franchiseStar !== null) queues.star.unshift(franchiseStar);

  const ordered: CapRushSourcePlayer[] = [];
  const tierOrder: readonly OvrTier[] = ['star', 'starter', 'rotation', 'budget'];
  let cycleIndex = 0;
  while (ordered.length < selected.length) {
    const preferredTier = OPENING_TIER_CYCLE[cycleIndex % OPENING_TIER_CYCLE.length] ?? 'star';
    cycleIndex += 1;
    let picked = queues[preferredTier].shift();
    if (picked === undefined) {
      for (const fallbackTier of tierOrder) {
        picked = queues[fallbackTier].shift();
        if (picked !== undefined) break;
      }
    }
    if (picked !== undefined) ordered.push(picked);
  }
  return ordered;
}

/**
 * Builds a deterministic, versioned, finite draft pool of distinct players with broad
 * OVR/position/affordability distribution and a mixed curated opening order.
 */
export function createFullCourtDraftPool(input: {
  readonly runSeed: string;
  readonly index: FullCourtCatalogIndex;
  readonly money: FullCourtMoneyConfig;
}): FullCourtDraftPool {
  const groups = groupDistinctPlayers(input.index);
  if (groups.length < FULL_COURT_MIN_ROSTER_SIZE) {
    throw new Error('The Full Court catalog and budget cannot fill a legal six-player roster');
  }

  const rng = createRng(`${FULL_COURT_POOL_VERSION}\u0000${input.runSeed}`);
  const budgetCap = Math.min(input.money.hardLimitDollars, input.money.startingWarChestDollars);
  const franchiseStarCandidates = [...input.index.catalog.candidates]
    .filter((candidate) => candidate.originalOverall >= 95)
    .sort((a, b) => compareStrings(a.playerVersionId, b.playerVersionId))
    .filter((candidate) => {
      const restMin = fullCourtCheapestPeople(input.index)
        .filter((person) => person.playerId !== candidate.playerId)
        .slice(0, FULL_COURT_MIN_ROSTER_SIZE - 1)
        .reduce((sum, person) => sum + person.salaryDollars, 0);
      return fullCourtSalaryDollarsOf(candidate) + restMin <= budgetCap;
    });
  const guaranteedStar =
    franchiseStarCandidates.length > 0 ? rng.pick(franchiseStarCandidates) : null;

  const representatives = groups.map((versions) => {
    const first = versions[0];
    if (first === undefined) throw new Error('A Full Court pool player has no catalog versions');
    if (guaranteedStar !== null && first.playerId === guaranteedStar.playerId) {
      return guaranteedStar;
    }
    return versions.length === 1 ? first : rng.pick(versions);
  });
  const targetSize = Math.min(FULL_COURT_POOL_TARGET_SIZE, representatives.length);

  let selected: CapRushSourcePlayer[];
  if (representatives.length <= targetSize) {
    selected = representatives;
  } else {
    const buckets: Record<OvrTier, Record<Position, CapRushSourcePlayer[]>> = {
      star: { PG: [], SG: [], SF: [], PF: [], C: [] },
      starter: { PG: [], SG: [], SF: [], PF: [], C: [] },
      rotation: { PG: [], SG: [], SF: [], PF: [], C: [] },
      budget: { PG: [], SG: [], SF: [], PF: [], C: [] },
    };
    for (const player of representatives) {
      if (guaranteedStar !== null && player.playerId === guaranteedStar.playerId) continue;
      const tier = ovrTierOf(player.originalOverall);
      const pos = player.positions[0] ?? 'PG';
      buckets[tier][pos].push(player);
    }
    for (const tier of ['star', 'starter', 'rotation', 'budget'] as const) {
      for (const pos of POSITIONS) {
        buckets[tier][pos] = shuffle(buckets[tier][pos], rng);
      }
    }

    const quotas = tierQuotasFor(targetSize);
    const chosen = new Set<PlayerId>();
    selected = [];
    if (guaranteedStar !== null) {
      chosen.add(guaranteedStar.playerId);
      selected.push(guaranteedStar);
      quotas.star = Math.max(0, quotas.star - 1);
    }

    for (const tier of ['star', 'starter', 'rotation', 'budget'] as const) {
      let remaining = quotas[tier];
      let progressed = true;
      while (remaining > 0 && progressed) {
        progressed = false;
        for (const pos of POSITIONS) {
          if (remaining <= 0) break;
          const next = buckets[tier][pos].pop();
          if (next !== undefined && !chosen.has(next.playerId)) {
            chosen.add(next.playerId);
            selected.push(next);
            remaining -= 1;
            progressed = true;
          }
        }
      }
    }

    if (selected.length < targetSize) {
      const leftovers = shuffle(
        representatives.filter((player) => !chosen.has(player.playerId)),
        rng,
      );
      for (const player of leftovers) {
        if (selected.length >= targetSize) break;
        chosen.add(player.playerId);
        selected.push(player);
      }
    }
  }

  const affordable = ensurePoolAffordability(selected, input.index, input.money, guaranteedStar);
  const ordered = mixCuratedOpeningOrder(affordable, guaranteedStar, rng);

  return fullCourtDraftPoolSchema.parse({
    poolVersion: FULL_COURT_POOL_VERSION,
    playerVersionIds: ordered.map((player) => player.playerVersionId),
  });
}
