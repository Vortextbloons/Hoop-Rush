import type {
  CapRushSourcePlayer,
  FullCourtDraftPool,
  FullCourtDraftState,
  PlayerId,
  PlayerVersionId,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import {
  assertCapRushCatalogSourceMatches,
  capRushCatalogIndexOf,
  type CapRushCatalogIndex,
} from '../cap-rush/catalog.ts';
import { capRushSalaryDollars } from '../cap-rush/salary.ts';
import { compareStrings } from '../../domain/math.ts';

/**
 * Full Court drafts from the same validated historical catalog as Cap Rush, so it reuses
 * that index for player records and version identity. Full Court limits draft
 * eligibility to its run pool when one is stored in the draft.
 */
export type FullCourtCatalogIndex = CapRushCatalogIndex;

export interface FullCourtSalaryPerson {
  readonly playerId: PlayerId;
  readonly playerVersionId: PlayerVersionId;
  readonly salaryDollars: number;
}

const cheapestPeopleCache = new WeakMap<FullCourtCatalogIndex, readonly FullCourtSalaryPerson[]>();

export function fullCourtDraftIndexOf(
  catalog: SeasonDraftCatalog,
  source: CapRushCatalogIndex['catalog']['source'],
): FullCourtCatalogIndex {
  const index = capRushCatalogIndexOf(catalog, source);
  assertCapRushCatalogSourceMatches(index.catalog.source, source);
  return index;
}

export function fullCourtPlayerOf(
  index: FullCourtCatalogIndex,
  playerVersionId: PlayerVersionId,
): CapRushSourcePlayer | null {
  return index.byVersionId.get(playerVersionId) ?? null;
}

/** Returns the player only if present in the catalog and (when a pool is set) in the draft pool. */
export function fullCourtPoolPlayerOf(
  index: FullCourtCatalogIndex,
  state: Pick<FullCourtDraftState, 'pool'>,
  playerVersionId: PlayerVersionId,
): CapRushSourcePlayer | null {
  const player = fullCourtPlayerOf(index, playerVersionId);
  if (player === null) return null;
  if (state.pool === undefined) return player;
  return state.pool.playerVersionIds.includes(playerVersionId) ? player : null;
}

/** Returns eligible candidates in pool opening order, or all catalog candidates for legacy saves. */
export function fullCourtEligibleCandidates(
  index: FullCourtCatalogIndex,
  state?: Pick<FullCourtDraftState, 'pool'>,
): readonly CapRushSourcePlayer[] {
  if (state?.pool === undefined) return index.catalog.candidates;
  const eligible: CapRushSourcePlayer[] = [];
  for (const playerVersionId of state.pool.playerVersionIds) {
    const player = index.byVersionId.get(playerVersionId);
    if (player === undefined) {
      throw new Error(`draft pool player ${playerVersionId} is missing from the loaded catalog`);
    }
    eligible.push(player);
  }
  return eligible;
}

/** Cap Rush's salary curve and era adjustment, reused unchanged. */
export function fullCourtSalaryDollarsOf(player: CapRushSourcePlayer): number {
  return capRushSalaryDollars(player.originalOverall, player.seasonKey);
}

function computeCheapestPeople(
  candidates: readonly CapRushSourcePlayer[],
): readonly FullCourtSalaryPerson[] {
  const byPerson = new Map<PlayerId, FullCourtSalaryPerson>();
  for (const player of candidates) {
    const salaryDollars = fullCourtSalaryDollarsOf(player);
    const current = byPerson.get(player.playerId);
    const beatsCurrent =
      current === undefined ||
      salaryDollars < current.salaryDollars ||
      (salaryDollars === current.salaryDollars &&
        compareStrings(player.playerVersionId, current.playerVersionId) < 0);
    if (!beatsCurrent) continue;
    byPerson.set(player.playerId, {
      playerId: player.playerId,
      playerVersionId: player.playerVersionId,
      salaryDollars,
    });
  }
  return [...byPerson.values()].sort(
    (left, right) =>
      left.salaryDollars - right.salaryDollars || compareStrings(left.playerId, right.playerId),
  );
}

/**
 * One entry per real player, priced at their cheapest eligible version.
 *
 * Positions are advisory in Full Court, so a completion only needs distinct people; no
 * slot matching applies. Sorting by salary then player id keeps completion costs and depth
 * forecasts stable across catalog iteration order.
 */
export function fullCourtCheapestPeople(
  index: FullCourtCatalogIndex,
  pool?: FullCourtDraftPool,
): readonly FullCourtSalaryPerson[] {
  if (pool !== undefined)
    return computeCheapestPeople(fullCourtEligibleCandidates(index, { pool }));
  const cached = cheapestPeopleCache.get(index);
  if (cached !== undefined) return cached;
  const people = computeCheapestPeople(index.catalog.candidates);
  cheapestPeopleCache.set(index, people);
  return people;
}

/** Cheapest payroll that fills `places` distinct open roster places, or null if impossible. */
export function fullCourtMinimumCompletionDollars(
  index: FullCourtCatalogIndex,
  excludedPlayerIds: ReadonlySet<PlayerId>,
  places: number,
  pool?: FullCourtDraftPool,
): number | null {
  if (!Number.isInteger(places) || places < 0) {
    throw new Error(
      `full court completion requires a nonnegative integer place count (got ${String(places)})`,
    );
  }
  if (places === 0) return 0;
  let total = 0;
  let filled = 0;
  for (const person of fullCourtCheapestPeople(index, pool)) {
    if (excludedPlayerIds.has(person.playerId)) continue;
    total += person.salaryDollars;
    filled += 1;
    if (filled === places) return total;
  }
  return null;
}
