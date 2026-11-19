import {
  POSITIONS,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonKey,
} from '@hoop-rush/data-contracts';
import type { Rng } from '../sim/rng.ts';

const LEAGUE_TARGET_MIN = 65;
const LEAGUE_TARGET_MAX = 85;
const LEAGUE_BAND_RADIUS = 15;

export function historicalLeagueStrengthTarget(rng: Rng): number {
  return (
    LEAGUE_TARGET_MIN + ((rng.next() + rng.next()) / 2) * (LEAGUE_TARGET_MAX - LEAGUE_TARGET_MIN)
  );
}

export function chooseHistoricalTeam<T extends { readonly distance: number }>(
  choices: readonly T[],
  rng: Rng,
): T {
  const inBand = choices.filter((choice) => choice.distance <= LEAGUE_BAND_RADIUS);
  const nearestDistance = Math.min(...choices.map((choice) => choice.distance));
  const eligible =
    inBand.length > 0 ? inBand : choices.filter((choice) => choice.distance === nearestDistance);
  return rng.weightedPick(
    eligible,
    eligible.map((choice) => 1 + Math.max(0, 1 - choice.distance / LEAGUE_BAND_RADIUS)),
  );
}

export function groupHistoricalRosters(
  catalog: SeasonDraftCatalog,
): ReadonlyMap<string, ReadonlyMap<SeasonKey, readonly SeasonDraftCandidate[]>> {
  const seasons = new Map<string, Map<SeasonKey, SeasonDraftCandidate[]>>();
  for (const player of catalog.candidates) {
    if (player.anchors === undefined) continue;
    let franchise = seasons.get(player.franchiseId);
    if (franchise === undefined) {
      franchise = new Map<SeasonKey, SeasonDraftCandidate[]>();
      seasons.set(player.franchiseId, franchise);
    }
    let roster = franchise.get(player.seasonKey);
    if (roster === undefined) {
      roster = [];
      franchise.set(player.seasonKey, roster);
    }
    roster.push(player);
  }
  return seasons;
}

export function adjacentHistoricalPlayers(
  seasons: ReadonlyMap<SeasonKey, readonly SeasonDraftCandidate[]>,
  seasonKey: SeasonKey,
): SeasonDraftCandidate[] {
  const year = Number(seasonKey.slice(0, 4));
  return [...seasons].flatMap(([key, players]) =>
    Math.abs(Number(key.slice(0, 4)) - year) === 1 ? players : [],
  );
}

export function compareHistoricalMinutes(a: SeasonDraftCandidate, b: SeasonDraftCandidate): number {
  return (
    (b.anchors?.minutesPerGame ?? 0) - (a.anchors?.minutesPerGame ?? 0) ||
    a.playerVersionId.localeCompare(b.playerVersionId)
  );
}

export function historicalLineupOf(
  candidates: readonly SeasonDraftCandidate[],
  seasonKey: SeasonKey,
  adjacentLimit = 0,
): SeasonDraftCandidate[] | null {
  const ordered = [...candidates].sort(compareHistoricalMinutes);
  const byPosition = POSITIONS.map((position) =>
    ordered.filter((player) => player.positions.playable.includes(position)),
  );
  if (
    byPosition.some((players) => players.length === 0) ||
    byPosition.filter((players) => players.every((player) => player.seasonKey !== seasonKey))
      .length > adjacentLimit
  )
    return null;
  const selected: SeasonDraftCandidate[] = [];
  const used = new Set<string>();
  function assign(slot: number, remainingAdjacent: number): boolean {
    const players = byPosition[slot];
    if (players === undefined) return true;
    for (const player of players) {
      if (used.has(player.playerId)) continue;
      const adjacent = player.seasonKey !== seasonKey;
      if (adjacent && remainingAdjacent === 0) continue;
      selected.push(player);
      used.add(player.playerId);
      if (assign(slot + 1, remainingAdjacent - Number(adjacent))) return true;
      selected.pop();
      used.delete(player.playerId);
    }
    return false;
  }
  return assign(0, adjacentLimit) ? selected : null;
}
