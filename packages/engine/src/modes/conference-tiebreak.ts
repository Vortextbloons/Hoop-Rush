interface ConferenceTieTotals {
  readonly teamId: string;
  readonly conferenceWins: number;
  readonly conferenceLosses: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly headToHead: ReadonlyMap<string, { wins: number; losses: number }>;
}

type HeadToHeadMethod = 'pairwise' | 'tied-group';

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function ratioCompare(
  left: { wins: number; games: number },
  right: { wins: number; games: number },
): number {
  if (left.games === 0 || right.games === 0) {
    if (left.games === 0 && right.games === 0) return 0;
    return left.games === 0 ? 1 : -1;
  }
  const difference = right.wins * left.games - left.wins * right.games;
  return difference === 0 ? 0 : difference > 0 ? 1 : -1;
}

type Criterion = 'head-to-head' | 'conference' | 'point-differential' | 'points-for' | 'team-id';
const CRITERIA: readonly Criterion[] = [
  'head-to-head',
  'conference',
  'point-differential',
  'points-for',
  'team-id',
];

function partitionOnCriterion<T extends ConferenceTieTotals>(
  teams: readonly T[],
  criterion: Criterion,
  headToHead: HeadToHeadMethod,
): { sorted: T[]; groups: T[][] } {
  if (criterion === 'team-id') {
    const sorted = [...teams].sort((left, right) => compareCodeUnits(left.teamId, right.teamId));
    return { sorted, groups: sorted.map((team) => [team]) };
  }
  if (criterion === 'head-to-head' && headToHead === 'tied-group') {
    const unmatched = teams.some((team) =>
      teams.every((other) => !team.headToHead.has(other.teamId)),
    );
    if (unmatched) return { sorted: [...teams], groups: [[...teams]] };
  }
  const valueOf = (team: T, other: T): number | { wins: number; games: number } => {
    switch (criterion) {
      case 'head-to-head': {
        if (headToHead === 'tied-group') {
          let wins = 0;
          let games = 0;
          for (const opponent of teams) {
            const matchup = team.headToHead.get(opponent.teamId);
            if (matchup === undefined) continue;
            wins += matchup.wins;
            games += matchup.wins + matchup.losses;
          }
          return { wins, games };
        }
        const record = team.headToHead.get(other.teamId) ?? { wins: 0, losses: 0 };
        return { wins: record.wins, games: record.wins + record.losses };
      }
      case 'conference':
        return { wins: team.conferenceWins, games: team.conferenceWins + team.conferenceLosses };
      case 'point-differential':
        return team.pointsFor - team.pointsAgainst;
      case 'points-for':
        return team.pointsFor;
    }
  };
  const compare = (left: T, right: T): number => {
    const a = valueOf(left, right);
    const b = valueOf(right, left);
    if (typeof a === 'number' && typeof b === 'number') {
      return b - a;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      return ratioCompare(a, b);
    }
    return 0;
  };
  const sorted = [...teams].sort(compare);
  const groups: T[][] = [];
  for (const team of sorted) {
    const current = groups[groups.length - 1];
    const previous = current?.[0];
    if (current !== undefined && previous !== undefined && compare(previous, team) === 0) {
      current.push(team);
    } else {
      groups.push([team]);
    }
  }
  return { sorted, groups };
}

export function resolveConferenceTieGroup<T extends ConferenceTieTotals>(
  teams: readonly T[],
  headToHead: HeadToHeadMethod,
  index = 0,
): T[] {
  if (teams.length <= 1) return [...teams];
  if (index >= CRITERIA.length) {
    return [...teams].sort((left, right) => compareCodeUnits(left.teamId, right.teamId));
  }
  const criterion = CRITERIA[index];
  if (criterion === undefined) return [...teams];
  const { sorted, groups } = partitionOnCriterion(teams, criterion, headToHead);
  if (groups.length === 1) return resolveConferenceTieGroup(sorted, headToHead, index + 1);
  return groups.flatMap((group) => resolveConferenceTieGroup(group, headToHead, index + 1));
}
