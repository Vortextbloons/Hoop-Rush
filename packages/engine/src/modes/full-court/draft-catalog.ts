import type {
  CapRushSourcePlayer,
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
 * that index (player records, version identity, salary arithmetic) as-is. Full Court adds
 * only its own positions-advisory, eligibility-free lookups below.
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

/** Cap Rush's salary curve and era adjustment, reused unchanged. */
export function fullCourtSalaryDollarsOf(player: CapRushSourcePlayer): number {
  return capRushSalaryDollars(player.originalOverall, player.seasonKey);
}

/**
 * One entry per real player, priced at their cheapest catalog version.
 *
 * Positions are advisory in Full Court, so a completion only needs distinct people; no
 * slot matching applies. Sorting by salary then player id keeps completion costs and depth
 * forecasts stable across catalog iteration order.
 */
export function fullCourtCheapestPeople(
  index: FullCourtCatalogIndex,
): readonly FullCourtSalaryPerson[] {
  const cached = cheapestPeopleCache.get(index);
  if (cached !== undefined) return cached;
  const byPerson = new Map<PlayerId, FullCourtSalaryPerson>();
  for (const player of index.catalog.candidates) {
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
  const people = [...byPerson.values()].sort(
    (left, right) =>
      left.salaryDollars - right.salaryDollars || compareStrings(left.playerId, right.playerId),
  );
  cheapestPeopleCache.set(index, people);
  return people;
}

/** Cheapest payroll that fills `places` distinct open roster places, or null if impossible. */
export function fullCourtMinimumCompletionDollars(
  index: FullCourtCatalogIndex,
  excludedPlayerIds: ReadonlySet<PlayerId>,
  places: number,
): number | null {
  if (!Number.isInteger(places) || places < 0) {
    throw new Error(
      `full court completion requires a nonnegative integer place count (got ${String(places)})`,
    );
  }
  if (places === 0) return 0;
  let total = 0;
  let filled = 0;
  for (const person of fullCourtCheapestPeople(index)) {
    if (excludedPlayerIds.has(person.playerId)) continue;
    total += person.salaryDollars;
    filled += 1;
    if (filled === places) return total;
  }
  return null;
}
