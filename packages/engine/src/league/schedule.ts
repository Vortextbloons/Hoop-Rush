import type { Seed } from '@hoop-rush/data-contracts';
import { createRng, type Rng } from '../sim/rng.ts';
import type { LeagueAlignment, LeagueFieldTeam, LeagueFranchiseAssignment } from './types.ts';

export type { LeagueAlignment, LeagueFieldTeam, LeagueFranchiseAssignment } from './types.ts';

export interface LeagueFieldRules<Conference extends string, Division extends string> {
  readonly teamCount: number;
  readonly teamIds: readonly string[];
  readonly alignmentOf: (teamId: string) => LeagueAlignment<Conference, Division>;
  readonly label?: string;
}

export interface LeagueScheduleRules<
  Conference extends string,
  Division extends string,
> extends LeagueFieldRules<Conference, Division> {
  readonly gamesPerTeam: number;
  readonly divisionGamesPerTeam: number;
  readonly conferenceGamesPerTeam: number;
  readonly conferences: readonly Conference[];
  readonly divisions: Readonly<Record<Division, readonly string[]>>;
  readonly conferenceDivisions: Readonly<Record<Conference, readonly Division[]>>;
  readonly oppositeConferencePairs: readonly (readonly [Conference, Conference])[];
  readonly gameIdOf: (slot: number, homeTeamId: string, awayTeamId: string) => string;
  readonly scheduleSeed: (runSeed: Seed) => Seed;
  readonly assignmentSeed: (runSeed: Seed) => Seed;
}

export interface LeagueScheduleEntry {
  readonly gameId: string;
  readonly slot: number;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

export interface LeagueSchedule {
  readonly teams: readonly LeagueFieldTeam[];
  readonly games: readonly LeagueScheduleEntry[];
}

function labelOf(rules: { readonly label?: string }): string {
  return rules.label ?? 'league';
}

export function assignLeagueFranchise<Conference extends string, Division extends string>(input: {
  readonly runSeed: Seed;
  readonly field: readonly LeagueFieldTeam[];
  readonly rules: LeagueScheduleRules<Conference, Division>;
}): LeagueFranchiseAssignment<Conference, Division> {
  const { field, rules } = input;
  const label = labelOf(rules);
  const ordered = [...field].sort((left, right) =>
    left.teamId < right.teamId ? -1 : left.teamId > right.teamId ? 1 : 0,
  );
  if (ordered.length !== rules.teamCount) {
    throw new Error(
      `${label} takeover requires ${String(rules.teamCount)} franchises (got ${String(ordered.length)})`,
    );
  }
  for (const team of ordered) rules.alignmentOf(team.teamId);
  const rng = createRng(rules.assignmentSeed(input.runSeed));
  const assigned = rng.pick(ordered);
  const alignment = rules.alignmentOf(assigned.teamId);
  return {
    franchiseId: assigned.teamId,
    displayName: assigned.displayName,
    conference: alignment.conference,
    division: alignment.division,
  };
}

export function validateLeagueField<Conference extends string, Division extends string>(
  field: readonly LeagueFieldTeam[],
  rules: LeagueFieldRules<Conference, Division>,
): void {
  const label = labelOf(rules);
  if (field.length !== rules.teamCount) {
    throw new Error(
      `${label} league field requires ${String(rules.teamCount)} franchises (got ${String(field.length)})`,
    );
  }
  const seen = new Set<string>();
  for (const team of field) {
    if (seen.has(team.teamId)) {
      throw new Error(`${label} league field repeats franchise ${team.teamId}`);
    }
    seen.add(team.teamId);
    rules.alignmentOf(team.teamId);
  }
  for (const teamId of rules.teamIds) {
    if (!seen.has(teamId)) {
      throw new Error(`${label} league field is missing franchise ${teamId}`);
    }
  }
}

export function leagueFieldOf<Conference extends string, Division extends string>(
  bracket: { readonly opponents: readonly LeagueFieldTeam[] },
  rules: LeagueFieldRules<Conference, Division>,
): LeagueFieldTeam[] {
  const field = bracket.opponents.map((opponent) => ({
    teamId: opponent.teamId,
    displayName: opponent.displayName,
  }));
  validateLeagueField(field, rules);
  return field;
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function pairOf(key: string): [string, string] {
  const [left, right] = key.split('|');
  if (left === undefined || right === undefined)
    throw new Error(`league schedule: bad pair ${key}`);
  return [left, right];
}

interface PairQuota {
  readonly left: string;
  readonly right: string;
  readonly games: number;
  leftHome: number;
}

function divisionTeams<Conference extends string, Division extends string>(
  rules: LeagueScheduleRules<Conference, Division>,
  division: Division,
): readonly string[] {
  return rules.divisions[division];
}

function conferenceTeams<Conference extends string, Division extends string>(
  rules: LeagueScheduleRules<Conference, Division>,
  conference: Conference,
): readonly string[] {
  return rules.conferenceDivisions[conference].flatMap((division) =>
    divisionTeams(rules, division),
  );
}

function conferenceDivisions<Conference extends string, Division extends string>(
  rules: LeagueScheduleRules<Conference, Division>,
  conference: Conference,
): readonly Division[] {
  return rules.conferenceDivisions[conference];
}

function threeGameOrientation<Conference extends string, Division extends string>(
  conference: Conference,
  pairs: readonly PairQuota[],
  rules: LeagueScheduleRules<Conference, Division>,
): Map<string, boolean> {
  const three = pairs.filter((pair) => pair.games === 3);
  const adjacency = new Map<string, string[]>();
  for (const team of conferenceTeams(rules, conference)) {
    adjacency.set(team, []);
  }
  for (const pair of three) {
    adjacency.get(pair.left)?.push(pair.right);
    adjacency.get(pair.right)?.push(pair.left);
  }
  const remaining = new Map<string, string[]>();
  for (const [team, neighbours] of adjacency) remaining.set(team, [...neighbours]);
  const first = [...adjacency.keys()].sort()[0];
  if (first === undefined)
    throw new Error(`${labelOf(rules)} schedule: an empty conference has no teams`);
  const circuit: string[] = [];
  const stack: string[] = [first];
  while (stack.length > 0) {
    const team = stack[stack.length - 1];
    if (team === undefined) break;
    const neighbours = remaining.get(team) ?? [];
    if (neighbours.length === 0) {
      stack.pop();
      circuit.push(team);
      continue;
    }
    const next = neighbours.pop();
    if (next === undefined) continue;
    const reverse = remaining.get(next) ?? [];
    const index = reverse.indexOf(team);
    if (index >= 0) reverse.splice(index, 1);
    remaining.set(next, reverse);
    stack.push(next);
  }
  if (circuit.length !== three.length + 1) {
    throw new Error(`${labelOf(rules)} schedule: the three-game graph is not Eulerian`);
  }
  const oriented = new Map<string, boolean>();
  const edges = [...circuit].reverse();
  for (let index = 0; index + 1 < edges.length; index += 1) {
    const from = edges[index];
    const to = edges[index + 1];
    if (from === undefined || to === undefined) continue;
    const pair = pairOf(pairKey(from, to));
    oriented.set(pairKey(from, to), pair[0] === from);
  }
  return oriented;
}

function buildPairQuotas<Conference extends string, Division extends string>(
  rng: Rng,
  rules: LeagueScheduleRules<Conference, Division>,
): PairQuota[] {
  const quotas = new Map<string, number>();
  const set = (left: string, right: string, games: number): void => {
    quotas.set(pairKey(left, right), games);
  };
  for (const conference of rules.conferences) {
    for (const division of conferenceDivisions(rules, conference)) {
      const teams = divisionTeams(rules, division);
      for (let left = 0; left < teams.length; left += 1) {
        for (let right = left + 1; right < teams.length; right += 1) {
          set(teams[left] ?? '', teams[right] ?? '', 4);
        }
      }
    }
  }
  for (const conference of rules.conferences) {
    const divisions = conferenceDivisions(rules, conference);
    for (let left = 0; left < divisions.length; left += 1) {
      for (let right = left + 1; right < divisions.length; right += 1) {
        const firstDivision = divisions[left];
        const secondDivision = divisions[right];
        if (firstDivision === undefined || secondDivision === undefined) continue;
        const first = divisionTeams(rules, firstDivision);
        const second = divisionTeams(rules, secondDivision);
        const shift = rng.nextInt(0, second.length - 1);
        for (let index = 0; index < first.length; index += 1) {
          for (let offset = 0; offset < 3; offset += 1) {
            quotas.set(
              pairKey(first[index] ?? '', second[(index + shift + offset) % second.length] ?? ''),
              4,
            );
          }
        }
        for (const leftTeam of first) {
          for (const rightTeam of second) {
            const key = pairKey(leftTeam, rightTeam);
            if (!quotas.has(key)) quotas.set(key, 3);
          }
        }
      }
    }
  }
  for (const [leftConference, rightConference] of rules.oppositeConferencePairs) {
    const left = conferenceTeams(rules, leftConference);
    const right = conferenceTeams(rules, rightConference);
    for (const leftTeam of left) {
      for (const rightTeam of right) quotas.set(pairKey(leftTeam, rightTeam), 2);
    }
  }
  const pairs: PairQuota[] = [...quotas.entries()].map(([key, games]) => {
    const [left, right] = pairOf(key);
    return { left, right, games, leftHome: 0 };
  });
  const oriented = new Map<string, boolean>();
  for (const conference of rules.conferences) {
    const conferencePairs = pairs.filter(
      (pair) =>
        rules.alignmentOf(pair.left).conference === conference &&
        rules.alignmentOf(pair.right).conference === conference,
    );
    for (const [key, value] of threeGameOrientation(conference, conferencePairs, rules)) {
      oriented.set(key, value);
    }
  }
  for (const pair of pairs) {
    if (pair.games === 3) {
      const firstGetsTwo = oriented.get(pairKey(pair.left, pair.right));
      if (firstGetsTwo === undefined) {
        throw new Error(
          `${labelOf(rules)} schedule: missing orientation for ${pair.left} vs ${pair.right}`,
        );
      }
      pair.leftHome = firstGetsTwo ? 2 : 1;
    } else {
      pair.leftHome = pair.games / 2;
    }
  }
  return pairs;
}

function findPerfectMatching(
  remaining: ReadonlyMap<string, number>,
  teams: readonly string[],
  rng: Rng,
): Array<[string, string]> | null {
  const adjacency = new Map<string, string[]>();
  for (const team of teams) adjacency.set(team, []);
  for (const [key, games] of remaining) {
    if (games <= 0) continue;
    const [left, right] = pairOf(key);
    adjacency.get(left)?.push(right);
    adjacency.get(right)?.push(left);
  }
  for (const [team, neighbours] of adjacency) {
    const shuffled: string[] = [];
    const pool = [...neighbours];
    while (pool.length > 0) {
      const index = rng.nextInt(0, pool.length - 1);
      const picked = pool.splice(index, 1)[0];
      if (picked !== undefined) shuffled.push(picked);
    }
    adjacency.set(team, shuffled);
  }
  const used = new Set<string>();
  const pairing: Array<[string, string]> = [];
  const solve = (): boolean => {
    let chosen: string | null = null;
    let options: string[] = [];
    for (const team of teams) {
      if (used.has(team)) continue;
      const available = (adjacency.get(team) ?? []).filter((other) => !used.has(other));
      if (available.length === 0) return false;
      if (chosen === null || available.length < options.length) {
        chosen = team;
        options = available;
      }
      if (options.length === 1) break;
    }
    if (chosen === null) return true;
    for (const other of options) {
      used.add(chosen);
      used.add(other);
      pairing.push([chosen, other]);
      if (solve()) return true;
      pairing.pop();
      used.delete(chosen);
      used.delete(other);
    }
    return false;
  };
  return solve() ? pairing : null;
}

function planRounds(
  pairs: readonly PairQuota[],
  teams: readonly string[],
  gamesPerTeam: number,
  rng: Rng,
) {
  const remaining = new Map<string, number>();
  for (const pair of pairs) remaining.set(pairKey(pair.left, pair.right), pair.games);
  const rounds: Array<Array<[string, string]>> = [];
  for (let round = 0; round < gamesPerTeam; round += 1) {
    const matching = findPerfectMatching(remaining, teams, rng);
    if (matching === null) return null;
    for (const [left, right] of matching) {
      const key = pairKey(left, right);
      remaining.set(key, (remaining.get(key) ?? 0) - 1);
    }
    rounds.push(matching);
  }
  for (const value of remaining.values()) if (value !== 0) return null;
  return rounds;
}

function assignHomeCourt(
  rounds: ReadonlyArray<Array<[string, string]>>,
  pairs: readonly PairQuota[],
  gameIdOf: (slot: number, homeTeamId: string, awayTeamId: string) => string,
): LeagueScheduleEntry[] {
  const byPair = new Map(pairs.map((pair) => [pairKey(pair.left, pair.right), pair]));
  const seen = new Map<string, number>();
  const entries: LeagueScheduleEntry[] = [];
  for (let index = 0; index < rounds.length; index += 1) {
    const slot = index + 1;
    for (const [first, second] of rounds[index] ?? []) {
      const key = pairKey(first, second);
      const pair = byPair.get(key);
      if (pair === undefined) throw new Error(`league schedule: unknown pairing ${key}`);
      const ordinal = seen.get(key) ?? 0;
      seen.set(key, ordinal + 1);
      const leftHome = Math.floor(((ordinal + 1) * pair.leftHome) / pair.games);
      const previousLeftHome = Math.floor((ordinal * pair.leftHome) / pair.games);
      const leftIsHome = leftHome > previousLeftHome;
      const home = leftIsHome ? pair.left : pair.right;
      const away = leftIsHome ? pair.right : pair.left;
      entries.push({
        gameId: gameIdOf(slot, home, away),
        slot,
        homeTeamId: home,
        awayTeamId: away,
      });
    }
  }
  return entries;
}

export function buildLeagueSchedule<Conference extends string, Division extends string>(input: {
  readonly runSeed: Seed;
  readonly field: readonly LeagueFieldTeam[];
  readonly rules: LeagueScheduleRules<Conference, Division>;
}): LeagueSchedule {
  const { rules } = input;
  validateLeagueField(input.field, rules);
  const teams = [...input.field].map((team) => team.teamId).sort();
  const seed = rules.scheduleSeed(input.runSeed);
  let lastFailures: string[] = [];
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const rng = createRng(seed, attempt);
    const pairs = buildPairQuotas(rng, rules);
    const rounds = planRounds(pairs, teams, rules.gamesPerTeam, rng);
    if (rounds === null) {
      lastFailures = ['round planning failed'];
      continue;
    }
    const games = assignHomeCourt(rounds, pairs, rules.gameIdOf);
    const failures = validateLeagueSchedule(games, input.field, rules);
    if (failures.length === 0) return { teams: input.field, games };
    lastFailures = failures;
  }
  throw new Error(
    `${labelOf(rules)} schedule: failed to generate a valid ${String(rules.gamesPerTeam)}-game league schedule: ${lastFailures.slice(0, 6).join('; ')}`,
  );
}

export function validateLeagueSchedule<Conference extends string, Division extends string>(
  games: readonly LeagueScheduleEntry[],
  field: readonly LeagueFieldTeam[],
  rules: LeagueScheduleRules<Conference, Division>,
): string[] {
  const failures: string[] = [];
  const ids = new Set(field.map((team) => team.teamId));
  const expectedGames = (rules.teamCount * rules.gamesPerTeam) / 2;
  if (games.length !== expectedGames) {
    failures.push(`schedule must hold ${String(expectedGames)} games`);
  }
  const half = rules.gamesPerTeam / 2;
  const home = new Map<string, number>();
  const away = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  const slots = new Map<number, Set<string>>();
  for (const game of games) {
    if (!ids.has(game.homeTeamId) || !ids.has(game.awayTeamId)) {
      failures.push(`game ${game.gameId} references an unknown team`);
      continue;
    }
    if (game.homeTeamId === game.awayTeamId) {
      failures.push(`game ${game.gameId} plays a team against itself`);
    }
    const slotTeams = slots.get(game.slot) ?? new Set<string>();
    if (slotTeams.has(game.homeTeamId) || slotTeams.has(game.awayTeamId)) {
      failures.push(`slot ${String(game.slot)} double-books a team`);
    }
    slotTeams.add(game.homeTeamId);
    slotTeams.add(game.awayTeamId);
    slots.set(game.slot, slotTeams);
    home.set(game.homeTeamId, (home.get(game.homeTeamId) ?? 0) + 1);
    away.set(game.awayTeamId, (away.get(game.awayTeamId) ?? 0) + 1);
    const key = pairKey(game.homeTeamId, game.awayTeamId);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  for (let slot = 1; slot <= rules.gamesPerTeam; slot += 1) {
    if ((slots.get(slot)?.size ?? 0) !== rules.teamCount) {
      failures.push(`slot ${String(slot)} does not schedule every team`);
    }
  }
  for (const team of field) {
    const homeGames = home.get(team.teamId) ?? 0;
    const awayGames = away.get(team.teamId) ?? 0;
    if (homeGames !== half || awayGames !== half) {
      failures.push(`${team.teamId} plays ${String(homeGames)} home and ${String(awayGames)} away`);
    }
  }
  for (const team of field) {
    const alignment = rules.alignmentOf(team.teamId);
    let divisionGames = 0;
    let conferenceGames = 0;
    for (const [key, count] of pairCounts) {
      const [left, right] = pairOf(key);
      if (left !== team.teamId && right !== team.teamId) continue;
      const other = left === team.teamId ? right : left;
      const otherAlignment = rules.alignmentOf(other);
      if (otherAlignment.division === alignment.division) divisionGames += count;
      else if (otherAlignment.conference === alignment.conference) conferenceGames += count;
    }
    if (divisionGames !== rules.divisionGamesPerTeam) {
      failures.push(`${team.teamId} plays ${String(divisionGames)} division games`);
    }
    if (conferenceGames !== rules.conferenceGamesPerTeam) {
      failures.push(`${team.teamId} plays ${String(conferenceGames)} conference games`);
    }
  }
  if (pairCounts.size !== (rules.teamCount * (rules.teamCount - 1)) / 2) {
    failures.push('schedule must pair every franchise');
  }
  return failures;
}

export function leagueUserScheduleOf(input: {
  readonly games: readonly LeagueScheduleEntry[];
  readonly userTeamId: string;
  readonly gamesPerTeam: number;
  readonly label?: string;
}): Array<{ gameNumber: number; opponentId: string; humanHome: boolean }> {
  const label = input.label ?? 'league';
  const entries = input.games
    .filter((game) => game.homeTeamId === input.userTeamId || game.awayTeamId === input.userTeamId)
    .sort((left, right) => left.slot - right.slot);
  if (entries.length !== input.gamesPerTeam) {
    throw new Error(`${label} schedule: user team plays ${String(entries.length)} games`);
  }
  return entries.map((game, index) => {
    if (game.slot !== index + 1) {
      throw new Error(`${label} schedule: the user must play one game per slot`);
    }
    const humanHome = game.homeTeamId === input.userTeamId;
    const opponentId = humanHome ? game.awayTeamId : game.homeTeamId;
    return { gameNumber: index + 1, opponentId, humanHome };
  });
}
