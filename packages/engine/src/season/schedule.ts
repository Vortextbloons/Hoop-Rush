import {
  SEASON_GAME_COUNT,
  SEASON_LEAGUE_VERSION,
  SEASON_ROUND_COUNT,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_TEAM_COUNT,
  seasonNamespaceSeed,
  seasonScheduleSchema,
  type SeasonLeague,
  type SeasonSchedule,
  type SeasonScheduleGame,
  type Seed,
} from '@hoop-rush/data-contracts';
import { createRng, shuffle } from '../sim/rng.js';
import {
  conferenceNonDivisionOpponentsOf,
  divisionOpponentsOf,
  oppositeConferenceOpponentsOf,
} from './league.js';

/**
 * Deterministic Season Run schedule generator (spec/2.0/02,
 * schedule-formula-v1). Produces the frozen league schedule: 82 abstract
 * rounds of 15 games, 41 home and 41 away per team, four games against
 * every division opponent, four games against six and three games against
 * four of the other same-conference opponents, and two games against every
 * opposite-conference opponent.
 *
 * Construction: the frozen frequency formula becomes an 82-regular
 * undirected multigraph. A deterministic blossom-based factorization produces
 * 82 perfect matchings, and pair-specific orientation produces the required
 * home/away counts. Pure TypeScript: no Svelte, persistence, worker, or
 * network code.
 */

export const SEASON_SCHEDULE_GENERATION_VERSION = 'schedule-gen-v2';

export interface GenerateSeasonScheduleInput {
  league: SeasonLeague;
  seed: Seed;
  /** Defaults to SEASON_SCHEDULE_GENERATION_VERSION. */
  generationVersion?: string;
}

/** An undirected edge that can appear in one or more extra rounds. */
interface ExtraEdge {
  id: number;
  a: number;
  b: number;
  remaining: number;
  total: number;
  /** Number of copies hosted by endpoint `a`; the rest are hosted by `b`. */
  homeCopies: number;
}

type Factor = Array<{ edgeId: number; a: number; b: number }>;

/**
 * Returns one maximum matching using Edmonds' blossom algorithm. The graph is
 * tiny (30 teams), so rebuilding its adjacency list for each factor keeps the
 * implementation simple and still gives a hard, sub-millisecond-sized bound
 * compared with the old local-search repair.
 */
function maximumMatching(adjacency: readonly number[][]): number[] {
  const n = adjacency.length;
  const match = new Array<number>(n).fill(-1);
  const parent = new Array<number>(n);
  const base = new Array<number>(n);
  const used = new Array<boolean>(n);
  const blossom = new Array<boolean>(n);

  const lca = (left: number, right: number): number => {
    const seen = new Array<boolean>(n).fill(false);
    let a = left;
    for (;;) {
      a = base[a] ?? a;
      seen[a] = true;
      const paired = match[a] ?? -1;
      if (paired < 0) break;
      const next = parent[paired] ?? -1;
      if (next < 0) break;
      a = next;
    }
    let b = right;
    for (;;) {
      b = base[b] ?? b;
      if (seen[b]) return b;
      const paired = match[b] ?? -1;
      if (paired < 0) break;
      const next = parent[paired] ?? -1;
      if (next < 0) break;
      b = next;
    }
    return -1;
  };

  const markPath = (vertex: number, root: number, child: number): void => {
    let v = vertex;
    let childOnPath = child;
    while ((base[v] ?? v) !== root) {
      blossom[base[v] ?? v] = true;
      const paired = match[v] ?? -1;
      if (paired < 0) return;
      blossom[base[paired] ?? paired] = true;
      parent[v] = childOnPath;
      childOnPath = paired;
      const next = parent[paired] ?? -1;
      if (next < 0) return;
      v = next;
    }
  };

  const augmentingEndpoint = (root: number): number => {
    used.fill(false);
    parent.fill(-1);
    for (let i = 0; i < n; i += 1) base[i] = i;
    used[root] = true;
    const queue = [root];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head] ?? -1;
      head += 1;
      if (v < 0) continue;
      for (const u of adjacency[v] ?? []) {
        if ((base[v] ?? v) === (base[u] ?? u) || match[v] === u) continue;
        if (u === root || ((match[u] ?? -1) >= 0 && (parent[match[u] ?? -1] ?? -1) >= 0)) {
          const blossomBase = lca(v, u);
          if (blossomBase < 0) continue;
          blossom.fill(false);
          markPath(v, blossomBase, u);
          markPath(u, blossomBase, v);
          for (let i = 0; i < n; i += 1) {
            if (!blossom[base[i] ?? i]) continue;
            base[i] = blossomBase;
            if (!used[i]) {
              used[i] = true;
              queue.push(i);
            }
          }
        } else if ((parent[u] ?? -1) < 0) {
          parent[u] = v;
          const paired = match[u] ?? -1;
          if (paired < 0) return u;
          used[paired] = true;
          queue.push(paired);
        }
      }
    }
    return -1;
  };

  for (let root = 0; root < n; root += 1) {
    if ((match[root] ?? -1) >= 0) continue;
    const endpoint = augmentingEndpoint(root);
    if (endpoint < 0) continue;
    let v = endpoint;
    while (v >= 0) {
      const previous = parent[v] ?? -1;
      const next = previous < 0 ? -1 : (match[previous] ?? -1);
      match[v] = previous;
      if (previous >= 0) match[previous] = v;
      v = next;
    }
  }
  return match;
}

/**
 * Edge-colors the complete 82-regular schedule multigraph into 82 perfect
 * matchings. Each matching consumes one copy of every selected edge, so the
 * resulting rounds preserve the exact pair counts by construction.
 */
function factorizeScheduleGraph(
  teamCount: number,
  edges: ExtraEdge[],
  factorCount: number,
): Factor[] {
  const factors: Factor[] = [];
  for (let factorIndex = 0; factorIndex < factorCount; factorIndex += 1) {
    const adjacency: number[][] = Array.from({ length: teamCount }, () => []);
    for (const edge of edges) {
      if (edge.remaining <= 0) continue;
      adjacency[edge.a]?.push(edge.b);
      adjacency[edge.b]?.push(edge.a);
    }
    const match = maximumMatching(adjacency);
    const factor: Factor = [];
    for (let a = 0; a < teamCount; a += 1) {
      const b = match[a] ?? -1;
      if (b <= a) continue;
      const edge = edges.find(
        (candidate) => candidate.a === a && candidate.b === b && candidate.remaining > 0,
      );
      if (edge === undefined) {
        throw new Error(`extra factor ${String(factorIndex + 1)} selected an unavailable edge`);
      }
      factor.push({ edgeId: edge.id, a, b });
    }
    if (factor.length !== teamCount / 2) {
      throw new Error(`extra factor ${String(factorIndex + 1)} is not perfect`);
    }
    for (const selected of factor) {
      const edge = edges[selected.edgeId];
      if (edge === undefined || edge.remaining <= 0) {
        throw new Error('extra factor consumed an unavailable edge');
      }
      edge.remaining -= 1;
    }
    factors.push(factor);
  }
  if (edges.some((edge) => edge.remaining !== 0)) {
    throw new Error('extra factorization left unused edge capacity');
  }
  return factors;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('\u0000');
}

/**
 * Which six of the ten same-conference non-division opponents get four
 * games: a seeded three-regular bipartite graph between each pair of
 * divisions (each team connects to three teams of each other division), so
 * the choice is symmetric by construction and part of the frozen formula
 * (schedule-formula-v1). Every other non-division opponent receives three
 * games.
 */
function fourGameOpponents(league: SeasonLeague, seed: Seed): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const team of league.teams) {
    result.set(team.franchiseId, new Set());
  }
  const conferences = ['east', 'west'] as const;
  for (const conference of conferences) {
    const teamsByDivision = new Map<string, string[]>();
    for (const team of league.teams) {
      if (team.conference !== conference) continue;
      const list = teamsByDivision.get(team.division) ?? [];
      list.push(team.franchiseId);
      teamsByDivision.set(team.division, list);
    }
    const divisions = [...teamsByDivision.keys()].sort();
    for (let a = 0; a < divisions.length; a += 1) {
      for (let b = a + 1; b < divisions.length; b += 1) {
        const left = divisions[a];
        const right = divisions[b];
        if (left === undefined || right === undefined) continue;
        const leftTeams = [...(teamsByDivision.get(left) ?? [])].sort();
        const rightTeams = [...(teamsByDivision.get(right) ?? [])].sort();
        const rng = createRng(
          seasonNamespaceSeed(seed, 'schedule-formula', 'four-game', conference, left, right),
        );
        const shuffledRight = shuffle(rightTeams, rng);
        for (let i = 0; i < leftTeams.length; i += 1) {
          const l = leftTeams[i];
          if (l === undefined) continue;
          for (let offset = 0; offset < 3; offset += 1) {
            const r = shuffledRight[(i + offset) % shuffledRight.length];
            if (r === undefined) continue;
            result.get(l)?.add(r);
            result.get(r)?.add(l);
          }
        }
      }
    }
  }
  return result;
}

/**
 * Orients the three-game pairs so every team hosts twice in exactly two of
 * its four three-game pairings (forced by the 41-home total). Deterministic
 * backtracking over pair directions with a remaining-possibility bound; a
 * balanced orientation of a 4-regular graph always exists. Returns a map
 * team -> opponents against whom the team hosts twice.
 */
function orientThreeGamePairs(
  pairs: ReadonlyArray<readonly [string, string]>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const incident = new Map<string, string[]>();
  for (const pair of pairs) {
    const [a, b] = pair;
    result.set(a, new Set());
    result.set(b, new Set());
    incident.set(a, [...(incident.get(a) ?? []), b]);
    incident.set(b, [...(incident.get(b) ?? []), a]);
  }
  const counts = new Map<string, number>();
  for (const team of incident.keys()) counts.set(team, 0);
  const decided = new Set<string>();

  const remainingFor = (team: string): number =>
    (incident.get(team) ?? []).filter((opponent) => !decided.has(pairKey(team, opponent))).length;

  const solve = (index: number): boolean => {
    if (index >= pairs.length) {
      for (const count of counts.values()) {
        if (count !== 2) return false;
      }
      return true;
    }
    const pair = pairs[index];
    if (pair === undefined) throw new Error('missing three-game pair');
    const [a, b] = pair;
    decided.add(pairKey(a, b));
    const hosts = [a, b];
    for (const host of hosts) {
      const count = counts.get(host) ?? 0;
      if (count >= 2) continue;
      const other = host === a ? b : a;
      counts.set(host, count + 1);
      result.get(host)?.add(other);
      let feasible = true;
      for (const team of counts.keys()) {
        const current = counts.get(team) ?? 0;
        if (current > 2 || current + remainingFor(team) < 2) {
          feasible = false;
          break;
        }
      }
      if (feasible && solve(index + 1)) return true;
      result.get(host)?.delete(other);
      counts.set(host, count);
    }
    decided.delete(pairKey(a, b));
    return false;
  };

  if (!solve(0)) {
    throw new Error('three-game pair orientation failed (a balanced orientation must exist)');
  }
  return result;
}

/** Builds the complete undirected schedule multigraph with exact pair counts. */
function buildScheduleEdges(
  league: SeasonLeague,
  teamOrder: readonly string[],
  teamIndex: ReadonlyMap<string, number>,
  fourGame: ReadonlyMap<string, ReadonlySet<string>>,
  hostsTwice: ReadonlyMap<string, ReadonlySet<string>>,
): ExtraEdge[] {
  const teamsById = new Map(league.teams.map((team) => [team.franchiseId, team]));
  const edges: ExtraEdge[] = [];
  for (let a = 0; a < teamOrder.length; a += 1) {
    const leftId = teamOrder[a];
    const left = leftId === undefined ? undefined : teamsById.get(leftId);
    if (leftId === undefined || left === undefined) continue;
    for (let b = a + 1; b < teamOrder.length; b += 1) {
      const rightId = teamOrder[b];
      const right = rightId === undefined ? undefined : teamsById.get(rightId);
      if (rightId === undefined || right === undefined) continue;
      let remaining = 2;
      let homeCopies = 1;
      if (left.conference === right.conference) {
        if (left.division === right.division) {
          remaining += 2;
          homeCopies = 2;
        } else if (fourGame.get(leftId)?.has(rightId)) {
          remaining += 2;
          homeCopies = 2;
        } else {
          remaining += 1;
          homeCopies = hostsTwice.get(leftId)?.has(rightId) ? 2 : 1;
        }
      }
      edges.push({
        id: edges.length,
        a: teamIndex.get(leftId) ?? -1,
        b: teamIndex.get(rightId) ?? -1,
        remaining,
        total: remaining,
        homeCopies,
      });
    }
  }
  const degree = new Array<number>(teamOrder.length).fill(0);
  for (const edge of edges) {
    degree[edge.a] = (degree[edge.a] ?? 0) + edge.remaining;
    degree[edge.b] = (degree[edge.b] ?? 0) + edge.remaining;
  }
  if (degree.some((value) => value !== SEASON_ROUND_COUNT)) {
    throw new Error('schedule-frequency graph is not 82-regular');
  }
  return edges;
}

/** Orients each pair's factor occurrences to its exact home/away split. */
function orientScheduleFactors(
  factors: readonly Factor[],
  edges: readonly ExtraEdge[],
  teamCount: number,
): Map<string, number> {
  const occurrencesByEdge = new Map<number, string[]>();
  for (let factorIndex = 0; factorIndex < factors.length; factorIndex += 1) {
    for (const edge of factors[factorIndex] ?? []) {
      const key = `${String(factorIndex)}:${String(edge.edgeId)}`;
      const occurrences = occurrencesByEdge.get(edge.edgeId) ?? [];
      occurrences.push(key);
      occurrencesByEdge.set(edge.edgeId, occurrences);
    }
  }
  const homeByOccurrence = new Map<string, number>();
  const homeCounts = new Array<number>(teamCount).fill(0);
  for (const edge of edges) {
    const occurrences = occurrencesByEdge.get(edge.id) ?? [];
    if (occurrences.length !== edge.total) {
      throw new Error(`pair edge ${String(edge.id)} has the wrong factor count`);
    }
    for (let i = 0; i < occurrences.length; i += 1) {
      const occurrence = occurrences[i];
      if (occurrence === undefined) continue;
      const home = i < edge.homeCopies ? edge.a : edge.b;
      homeByOccurrence.set(occurrence, home);
      homeCounts[home] = (homeCounts[home] ?? 0) + 1;
    }
  }
  if (homeByOccurrence.size !== factors.length * (teamCount / 2)) {
    throw new Error('schedule orientation did not cover every game');
  }
  if (homeCounts.some((count) => count !== SEASON_ROUND_COUNT / 2)) {
    throw new Error('schedule orientation is not home/away balanced');
  }
  return homeByOccurrence;
}

/** Deterministic schedule construction for one retry attempt. */
function buildScheduleAttempt(
  league: SeasonLeague,
  seed: Seed,
  generationVersion: string,
  attempt: number,
): SeasonSchedule {
  const teamOrder = shuffle(
    league.teams.map((team) => team.franchiseId),
    createRng(
      seasonNamespaceSeed(
        seed,
        'schedule-rounds',
        generationVersion,
        `attempt-${String(attempt)}`,
        'team-order',
      ),
    ),
  );
  const teamIndex = new Map<string, number>();
  for (const teamId of teamOrder) teamIndex.set(teamId, teamIndex.size);

  const fourGame = fourGameOpponents(league, seed);
  const threeGamePairs: Array<readonly [string, string]> = [];
  for (const team of league.teams) {
    for (const opponent of conferenceNonDivisionOpponentsOf(league, team.franchiseId)) {
      if (fourGame.get(team.franchiseId)?.has(opponent)) continue;
      const [a, b] = [team.franchiseId, opponent].sort();
      if (a === team.franchiseId && b !== undefined) threeGamePairs.push([a, b]);
    }
  }
  const hostsTwice = orientThreeGamePairs(threeGamePairs);
  const scheduleEdges = buildScheduleEdges(league, teamOrder, teamIndex, fourGame, hostsTwice);
  const factors = factorizeScheduleGraph(teamOrder.length, scheduleEdges, SEASON_ROUND_COUNT);
  const homes = orientScheduleFactors(factors, scheduleEdges, teamOrder.length);

  const rounds: Array<Array<{ home: string; away: string }>> = [];
  for (let factorIndex = 0; factorIndex < factors.length; factorIndex += 1) {
    const factor = factors[factorIndex] ?? [];
    rounds.push(
      factor.map((edge) => {
        const homeIndex = homes.get(`${String(factorIndex)}:${String(edge.edgeId)}`);
        if (homeIndex === undefined) throw new Error('missing game home orientation');
        const awayIndex = homeIndex === edge.a ? edge.b : edge.a;
        return { home: teamOrder[homeIndex] ?? '', away: teamOrder[awayIndex] ?? '' };
      }),
    );
  }
  if (rounds.length !== SEASON_ROUND_COUNT) {
    throw new Error(
      `generated ${String(rounds.length)} rounds (expected ${String(SEASON_ROUND_COUNT)})`,
    );
  }

  const games: Array<{ round: number; homeFranchiseId: string; awayFranchiseId: string }> = [];
  rounds.forEach((round, index) => {
    if (round.length !== teamOrder.length / 2) throw new Error('generated an incomplete round');
    for (const game of round) {
      games.push({ round: index + 1, homeFranchiseId: game.home, awayFranchiseId: game.away });
    }
  });
  games.sort(
    (a, b) =>
      a.round - b.round ||
      a.homeFranchiseId.localeCompare(b.homeFranchiseId) ||
      a.awayFranchiseId.localeCompare(b.awayFranchiseId),
  );
  const scheduled: SeasonScheduleGame[] = games.map((game, index) => ({
    gameId: `s${String(index + 1).padStart(6, '0')}`,
    round: game.round,
    homeFranchiseId: game.homeFranchiseId,
    awayFranchiseId: game.awayFranchiseId,
  }));

  const schedule: SeasonSchedule = {
    schemaVersion: 1,
    scheduleVersion: SEASON_SCHEDULE_VERSION,
    formulaVersion: SEASON_SCHEDULE_FORMULA_VERSION,
    leagueVersion: SEASON_LEAGUE_VERSION,
    generationSeed: seed,
    rounds: SEASON_ROUND_COUNT,
    games: scheduled,
  };
  const failures = auditSeasonSchedule(schedule, league);
  if (failures.length > 0) {
    throw new Error(`generated schedule fails its own audit: ${failures[0] ?? 'unknown'}`);
  }
  return schedule;
}

/** Generates the deterministic league schedule for the authoring seed. */
export function generateSeasonSchedule(input: GenerateSeasonScheduleInput): SeasonSchedule {
  const generationVersion = input.generationVersion ?? SEASON_SCHEDULE_GENERATION_VERSION;
  if (input.league.teams.length !== SEASON_TEAM_COUNT) {
    throw new Error(`league must have exactly ${String(SEASON_TEAM_COUNT)} teams`);
  }
  const maxAttempts = 12;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return buildScheduleAttempt(input.league, input.seed, generationVersion, attempt);
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw new Error(
    `schedule generation failed after ${String(maxAttempts)} attempts: ${lastError?.message ?? 'unknown'}`,
  );
}

/** Whether a generated schedule satisfies every frozen schedule invariant. */
export function auditSeasonSchedule(schedule: SeasonSchedule, league: SeasonLeague): string[] {
  const failures: string[] = [];

  const parsed = seasonScheduleSchema.safeParse(schedule);
  if (!parsed.success) {
    failures.push(`schedule fails the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  if (schedule.games.length !== SEASON_GAME_COUNT) {
    failures.push(
      `games must be ${String(SEASON_GAME_COUNT)} (got ${String(schedule.games.length)})`,
    );
    return failures;
  }

  const franchiseIds = new Set(league.teams.map((team) => team.franchiseId));
  const gameIds = new Set<string>();
  for (const game of schedule.games) {
    if (gameIds.has(game.gameId)) failures.push(`duplicate gameId ${game.gameId}`);
    gameIds.add(game.gameId);
    if (!franchiseIds.has(game.homeFranchiseId) || !franchiseIds.has(game.awayFranchiseId)) {
      failures.push(`game ${game.gameId} references a franchise outside the league`);
    }
    if (game.homeFranchiseId === game.awayFranchiseId) {
      failures.push(`game ${game.gameId} is a self-game`);
    }
  }

  const gamesByRound = new Map<number, SeasonScheduleGame[]>();
  for (const game of schedule.games) {
    const list = gamesByRound.get(game.round) ?? [];
    list.push(game);
    gamesByRound.set(game.round, list);
  }
  for (let round = 1; round <= SEASON_ROUND_COUNT; round += 1) {
    const list = gamesByRound.get(round) ?? [];
    if (list.length !== SEASON_TEAM_COUNT / 2) {
      failures.push(
        `round ${String(round)} must have ${String(SEASON_TEAM_COUNT / 2)} games (got ${String(list.length)})`,
      );
    }
    const seen = new Set<string>();
    for (const game of list) {
      if (seen.has(game.homeFranchiseId) || seen.has(game.awayFranchiseId)) {
        failures.push(`round ${String(round)} plays a franchise twice`);
      }
      seen.add(game.homeFranchiseId);
      seen.add(game.awayFranchiseId);
    }
    if (seen.size !== SEASON_TEAM_COUNT) {
      failures.push(
        `round ${String(round)} must cover all ${String(SEASON_TEAM_COUNT)} franchises (got ${String(seen.size)})`,
      );
    }
  }

  const homeCounts = new Map<string, number>();
  const awayCounts = new Map<string, number>();
  const totalCounts = new Map<string, number>();
  const opponentCounts = new Map<string, Map<string, number>>();
  const homeVersus = new Map<string, Map<string, number>>();
  for (const franchiseId of franchiseIds) {
    homeCounts.set(franchiseId, 0);
    awayCounts.set(franchiseId, 0);
    totalCounts.set(franchiseId, 0);
    opponentCounts.set(franchiseId, new Map());
    homeVersus.set(franchiseId, new Map());
  }
  for (const game of schedule.games) {
    homeCounts.set(game.homeFranchiseId, (homeCounts.get(game.homeFranchiseId) ?? 0) + 1);
    awayCounts.set(game.awayFranchiseId, (awayCounts.get(game.awayFranchiseId) ?? 0) + 1);
    totalCounts.set(game.homeFranchiseId, (totalCounts.get(game.homeFranchiseId) ?? 0) + 1);
    totalCounts.set(game.awayFranchiseId, (totalCounts.get(game.awayFranchiseId) ?? 0) + 1);
    const against = opponentCounts.get(game.homeFranchiseId) ?? new Map<string, number>();
    against.set(game.awayFranchiseId, (against.get(game.awayFranchiseId) ?? 0) + 1);
    const awayAgainst = opponentCounts.get(game.awayFranchiseId) ?? new Map<string, number>();
    awayAgainst.set(game.homeFranchiseId, (awayAgainst.get(game.homeFranchiseId) ?? 0) + 1);
    const homeVersusMap = homeVersus.get(game.homeFranchiseId) ?? new Map<string, number>();
    homeVersusMap.set(game.awayFranchiseId, (homeVersusMap.get(game.awayFranchiseId) ?? 0) + 1);
  }

  for (const team of league.teams) {
    const id = team.franchiseId;
    const total = totalCounts.get(id) ?? 0;
    const home = homeCounts.get(id) ?? 0;
    const away = awayCounts.get(id) ?? 0;
    if (total !== SEASON_ROUND_COUNT) {
      failures.push(`${id} must play ${String(SEASON_ROUND_COUNT)} games (got ${String(total)})`);
    }
    if (home !== SEASON_ROUND_COUNT / 2) {
      failures.push(
        `${id} must play ${String(SEASON_ROUND_COUNT / 2)} home games (got ${String(home)})`,
      );
    }
    if (away !== SEASON_ROUND_COUNT / 2) {
      failures.push(
        `${id} must play ${String(SEASON_ROUND_COUNT / 2)} away games (got ${String(away)})`,
      );
    }
    const counts = opponentCounts.get(id) ?? new Map<string, number>();
    for (const opponent of divisionOpponentsOf(league, id)) {
      if ((counts.get(opponent) ?? 0) !== 4) {
        failures.push(`${id} must play division opponent ${opponent} exactly 4 times`);
      }
      if ((homeVersus.get(id)?.get(opponent) ?? 0) !== 2) {
        failures.push(`${id} must host division opponent ${opponent} exactly twice`);
      }
    }
    let fourGameCount = 0;
    let threeGameCount = 0;
    let threeGameHome = 0;
    for (const opponent of conferenceNonDivisionOpponentsOf(league, id)) {
      const count = counts.get(opponent) ?? 0;
      if (count === 4) {
        fourGameCount += 1;
        if ((homeVersus.get(id)?.get(opponent) ?? 0) !== 2) {
          failures.push(`${id} must host four-game conference opponent ${opponent} exactly twice`);
        }
      } else if (count === 3) {
        threeGameCount += 1;
        const homeGames = homeVersus.get(id)?.get(opponent) ?? 0;
        if (homeGames !== 1 && homeGames !== 2) {
          failures.push(`${id} must host three-game conference opponent ${opponent} once or twice`);
        }
        threeGameHome += homeGames;
      } else {
        failures.push(
          `${id} must play conference opponent ${opponent} 3 or 4 times (got ${String(count)})`,
        );
      }
    }
    if (fourGameCount !== 6 || threeGameCount !== 4) {
      failures.push(
        `${id} must face 6 conference opponents four times and 4 three times (got ${String(fourGameCount)} and ${String(threeGameCount)})`,
      );
    }
    if (threeGameHome !== 6) {
      failures.push(
        `${id} must hold exactly 6 home games across its three-game pairings (got ${String(threeGameHome)})`,
      );
    }
    for (const opponent of oppositeConferenceOpponentsOf(league, id)) {
      if ((counts.get(opponent) ?? 0) !== 2) {
        failures.push(`${id} must play opposite-conference opponent ${opponent} exactly twice`);
      }
      if ((homeVersus.get(id)?.get(opponent) ?? 0) !== 1) {
        failures.push(`${id} must host opposite-conference opponent ${opponent} exactly once`);
      }
    }
  }

  return failures;
}
