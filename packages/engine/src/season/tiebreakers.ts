import {
  SEASON_SEED_NAMESPACES,
  franchiseIdSchema,
  idSchema,
  seasonNamespaceSeed,
  seedSchema,
  type SeasonLeague,
  type SeasonStandings,
  type SeasonStandingsRow,
  type SeasonTiebreakResolution,
  type SeasonTiebreakRule,
} from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.ts';
import { franchisesInConference } from './league.ts';
export type SeasonConferenceId = 'east' | 'west';
export interface SeasonConferenceRanking {
  conference: SeasonConferenceId;
  ranked: string[];
  topTen: string[];
  directSeeds: string[];
  playInSeeds: string[];
  resolutions: SeasonTiebreakResolution[];
}
export interface SeasonPostseasonRankings {
  east: SeasonConferenceRanking;
  west: SeasonConferenceRanking;
}
interface CriterionValue {
  label: string;
  value: number | string;
}
interface TiebreakCriterion {
  rule: SeasonTiebreakRule;
  applicable(group: readonly string[], ctx: RankContext): boolean;
  compare(a: string, b: string, group: readonly string[], ctx: RankContext): number;
  evidenceOf(teams: readonly string[], ctx: RankContext): readonly CriterionValue[];
}
interface RankContext {
  league: SeasonLeague;
  standings: SeasonStandings;
  rowOf: Map<string, SeasonStandingsRow>;
  sameEligible: Set<string> | null;
  oppositeEligible: Set<string> | null;
  resolutions: SeasonTiebreakResolution[];
  conference: SeasonConferenceId;
  seed: string;
}
const TWO_TEAM_CRITERIA: readonly TiebreakCriterion[] = [
  headToHeadCriterion(),
  divisionChampionCriterion(),
  divisionRecordCriterion(),
  conferenceRecordCriterion(),
  sameEligibleRecordCriterion(),
  oppositeEligibleRecordCriterion(),
  differentialCriterion(),
];
const MULTI_TEAM_CRITERIA: readonly TiebreakCriterion[] = [
  divisionChampionCriterion(),
  recordAmongTiedCriterion(),
  divisionRecordCriterion(),
  conferenceRecordCriterion(),
  sameEligibleRecordCriterion(),
  differentialCriterion(),
];
function compareWinPct(aw: number, al: number, bw: number, bl: number): number {
  const aOverB = aw * bl;
  const bOverA = bw * al;
  if (aOverB !== bOverA) return aOverB > bOverA ? -1 : 1;
  if (aw !== bw) return aw > bw ? -1 : 1;
  if (al !== bl) return al < bl ? -1 : 1;
  return 0;
}
function headToHeadOf(
  ctx: RankContext,
  a: string,
  b: string,
): {
  wins: number;
  losses: number;
} {
  const row = ctx.rowOf.get(a);
  const entry = row?.headToHead.find((h2h) => h2h.franchiseId === b);
  if (row === undefined || entry === undefined) {
    throw new Error(`tiebreak: no head-to-head slot for ${a} vs ${b}`);
  }
  return entry;
}
function recordAmongOf(
  ctx: RankContext,
  a: string,
  group: readonly string[],
): {
  wins: number;
  losses: number;
} {
  let wins = 0;
  let losses = 0;
  for (const other of group) {
    if (other === a) continue;
    const h2h = headToHeadOf(ctx, a, other);
    wins += h2h.wins;
    losses += h2h.losses;
  }
  return { wins, losses };
}
function recordVsEligibleOf(
  ctx: RankContext,
  a: string,
  eligible: Set<string> | null,
): {
  wins: number;
  losses: number;
} {
  let wins = 0;
  let losses = 0;
  if (eligible === null) return { wins, losses };
  for (const other of eligible) {
    if (other === a) continue;
    const h2h = headToHeadOf(ctx, a, other);
    wins += h2h.wins;
    losses += h2h.losses;
  }
  return { wins, losses };
}
function isDivisionChampion(ctx: RankContext, franchiseId: string): boolean {
  const team = ctx.league.teams.find((entry) => entry.franchiseId === franchiseId);
  if (team === undefined) {
    throw new Error(`tiebreak: ${franchiseId} is not part of the league`);
  }
  const row = ctx.rowOf.get(franchiseId);
  if (row === undefined) {
    throw new Error(`tiebreak: no standings row for ${franchiseId}`);
  }
  for (const other of ctx.league.teams) {
    if (other.franchiseId === franchiseId || other.division !== team.division) continue;
    const otherRow = ctx.rowOf.get(other.franchiseId);
    if (otherRow === undefined) {
      throw new Error(`tiebreak: no standings row for ${other.franchiseId}`);
    }
    const byPct = compareWinPct(otherRow.wins, otherRow.losses, row.wins, row.losses);
    if (byPct === -1 || (byPct === 0 && otherRow.wins > row.wins)) {
      return false;
    }
  }
  return true;
}
function recordLabelOf(wins: number, losses: number): string {
  return `${String(wins)}-${String(losses)}`;
}
function headToHeadCriterion(): TiebreakCriterion {
  return {
    rule: 'head-to-head',
    applicable: () => true,
    compare(a, b, _group, ctx) {
      const ab = headToHeadOf(ctx, a, b);
      const ba = headToHeadOf(ctx, b, a);
      return compareWinPct(ab.wins, ab.losses, ba.wins, ba.losses);
    },
    evidenceOf(teams, ctx) {
      const a = teams[0];
      const b = teams[1];
      if (a === undefined || b === undefined) return [];
      const ab = headToHeadOf(ctx, a, b);
      return [{ label: 'head-to-head record', value: recordLabelOf(ab.wins, ab.losses) }];
    },
  };
}
function recordAmongTiedCriterion(): TiebreakCriterion {
  return {
    rule: 'head-to-head',
    applicable: () => true,
    compare(a, b, group, ctx) {
      const ar = recordAmongOf(ctx, a, group);
      const br = recordAmongOf(ctx, b, group);
      return compareWinPct(ar.wins, ar.losses, br.wins, br.losses);
    },
    evidenceOf(teams, ctx) {
      return teams.map((teamId) => {
        const record = recordAmongOf(ctx, teamId, teams);
        return {
          label: `record among tied teams ${teamId}`,
          value: recordLabelOf(record.wins, record.losses),
        };
      });
    },
  };
}
function divisionChampionCriterion(): TiebreakCriterion {
  return {
    rule: 'division-champion',
    applicable: () => true,
    compare(a, b, _group, ctx) {
      const aChamp = isDivisionChampion(ctx, a);
      const bChamp = isDivisionChampion(ctx, b);
      if (aChamp === bChamp) return 0;
      return aChamp ? -1 : 1;
    },
    evidenceOf(teams, ctx) {
      const champion = teams.find((teamId) => isDivisionChampion(ctx, teamId));
      return [{ label: 'division champion', value: champion ?? 'none' }];
    },
  };
}
function divisionRecordCriterion(): TiebreakCriterion {
  const rowOf = (ctx: RankContext, franchiseId: string): SeasonStandingsRow => {
    const row = ctx.rowOf.get(franchiseId);
    if (row === undefined) throw new Error(`tiebreak: no standings row for ${franchiseId}`);
    return row;
  };
  return {
    rule: 'division-record',
    applicable(group, ctx) {
      const team = ctx.league.teams.find((entry) => entry.franchiseId === group[0]);
      if (team === undefined) return false;
      return group.every(
        (franchiseId) =>
          ctx.league.teams.find((entry) => entry.franchiseId === franchiseId)?.division ===
          team.division,
      );
    },
    compare(a, b, _group, ctx) {
      const aRow = rowOf(ctx, a);
      const bRow = rowOf(ctx, b);
      return compareWinPct(
        aRow.divisionWins,
        aRow.divisionLosses,
        bRow.divisionWins,
        bRow.divisionLosses,
      );
    },
    evidenceOf(teams, ctx) {
      return teams.map((teamId) => {
        const row = rowOf(ctx, teamId);
        return {
          label: `division record ${teamId}`,
          value: recordLabelOf(row.divisionWins, row.divisionLosses),
        };
      });
    },
  };
}
function conferenceRecordCriterion(): TiebreakCriterion {
  return {
    rule: 'conference-record',
    applicable: () => true,
    compare(a, b, _group, ctx) {
      const aRow = ctx.rowOf.get(a);
      const bRow = ctx.rowOf.get(b);
      if (aRow === undefined || bRow === undefined) {
        throw new Error('tiebreak: missing conference standings row');
      }
      return compareWinPct(
        aRow.conferenceWins,
        aRow.conferenceLosses,
        bRow.conferenceWins,
        bRow.conferenceLosses,
      );
    },
    evidenceOf(teams, ctx) {
      return teams.map((teamId) => {
        const row = ctx.rowOf.get(teamId);
        if (row === undefined) throw new Error('tiebreak: missing conference standings row');
        return {
          label: `conference record ${teamId}`,
          value: recordLabelOf(row.conferenceWins, row.conferenceLosses),
        };
      });
    },
  };
}
function sameEligibleRecordCriterion(): TiebreakCriterion {
  return {
    rule: 'playoff-teams-conference-record',
    applicable: () => true,
    compare(a, b, _group, ctx) {
      const ar = recordVsEligibleOf(ctx, a, ctx.sameEligible);
      const br = recordVsEligibleOf(ctx, b, ctx.sameEligible);
      return compareWinPct(ar.wins, ar.losses, br.wins, br.losses);
    },
    evidenceOf(teams, ctx) {
      return teams.map((teamId) => {
        const record = recordVsEligibleOf(ctx, teamId, ctx.sameEligible);
        return {
          label: `record vs conference playoff teams ${teamId}`,
          value: recordLabelOf(record.wins, record.losses),
        };
      });
    },
  };
}
function oppositeEligibleRecordCriterion(): TiebreakCriterion {
  return {
    rule: 'playoff-teams-other-conference-record',
    applicable: () => true,
    compare(a, b, _group, ctx) {
      const ar = recordVsEligibleOf(ctx, a, ctx.oppositeEligible);
      const br = recordVsEligibleOf(ctx, b, ctx.oppositeEligible);
      return compareWinPct(ar.wins, ar.losses, br.wins, br.losses);
    },
    evidenceOf(teams, ctx) {
      return teams.map((teamId) => {
        const record = recordVsEligibleOf(ctx, teamId, ctx.oppositeEligible);
        return {
          label: `record vs other-conference playoff teams ${teamId}`,
          value: recordLabelOf(record.wins, record.losses),
        };
      });
    },
  };
}
function differentialCriterion(): TiebreakCriterion {
  const differentialOf = (ctx: RankContext, franchiseId: string): number => {
    const row = ctx.rowOf.get(franchiseId);
    if (row === undefined) throw new Error(`tiebreak: no standings row for ${franchiseId}`);
    return row.pointsFor - row.pointsAgainst;
  };
  return {
    rule: 'points-differential',
    applicable: () => true,
    compare(a, b, _group, ctx) {
      const aDiff = differentialOf(ctx, a);
      const bDiff = differentialOf(ctx, b);
      return aDiff === bDiff ? 0 : aDiff > bDiff ? -1 : 1;
    },
    evidenceOf(teams, ctx) {
      return teams.map((teamId) => ({
        label: `points differential ${teamId}`,
        value: differentialOf(ctx, teamId),
      }));
    },
  };
}
function criteriaOf(group: readonly string[]): readonly TiebreakCriterion[] {
  return group.length === 2 ? TWO_TEAM_CRITERIA : MULTI_TEAM_CRITERIA;
}
function drawSeedOf(ctx: RankContext, group: readonly string[]): string {
  return seasonNamespaceSeed(
    ctx.seed,
    SEASON_SEED_NAMESPACES.postseasonTies,
    'draw',
    ...[...group].sort(),
  );
}
function recordResolution(
  ctx: RankContext,
  teams: readonly string[],
  rule: SeasonTiebreakRule,
  evidence: readonly CriterionValue[],
  drawSeed: string | null,
): void {
  ctx.resolutions.push({
    resolutionId: idSchema.parse(`tb-${ctx.conference}-${String(ctx.resolutions.length)}-${rule}`),
    conference: ctx.conference,
    kind: 'seeding',
    rule,
    teams: teams.map((team) => franchiseIdSchema.parse(team)),
    slots: [],
    evidence: evidence.slice(0, 8).map((entry) => ({ label: entry.label, value: entry.value })),
    drawSeed: drawSeed === null ? null : seedSchema.parse(drawSeed),
  });
}
function partitionByCriterion(
  ctx: RankContext,
  group: readonly string[],
  criterion: TiebreakCriterion,
): string[][] | null {
  const ids = [...group];
  const parent = new Map<string, string>(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) {
      const next = parent.get(root);
      if (next === undefined) break;
      root = next;
    }
    return root;
  };
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      if (a === undefined || b === undefined) continue;
      if (criterion.compare(a, b, group, ctx) === 0) {
        parent.set(find(a), find(b));
      }
    }
  }
  const clusters = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    const cluster = clusters.get(root) ?? [];
    cluster.push(id);
    clusters.set(root, cluster);
  }
  const ordered = [...clusters.values()];
  if (ordered.length <= 1) return null;
  ordered.sort((left, right) => {
    const a = left[0];
    const b = right[0];
    if (a === undefined || b === undefined) return 0;
    const result = criterion.compare(a, b, group, ctx);
    if (result !== 0) return result;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return ordered;
}
function recordWindows(
  ctx: RankContext,
  ordered: readonly string[],
  rule: SeasonTiebreakRule,
  evidenceOf: (teams: readonly string[]) => readonly CriterionValue[],
  drawSeed: string | null,
): void {
  if (ordered.length === 2 || ordered.length === 3) {
    recordResolution(ctx, ordered, rule, evidenceOf(ordered), drawSeed);
    return;
  }
  for (let i = 0; i < ordered.length - 1; i += 1) {
    recordResolution(
      ctx,
      ordered.slice(i, i + 2),
      rule,
      evidenceOf(ordered.slice(i, i + 2)),
      drawSeed,
    );
  }
}
function resolveTieGroup(ctx: RankContext, group: readonly string[]): string[] {
  const criteria = criteriaOf(group);
  for (const criterion of criteria) {
    if (!criterion.applicable(group, ctx)) continue;
    const clusters = partitionByCriterion(ctx, group, criterion);
    if (clusters === null) continue;
    if (clusters.length === group.length) {
      const ordered = clusters
        .map((cluster) => cluster[0])
        .filter((id): id is string => id !== undefined);
      recordWindows(
        ctx,
        ordered,
        criterion.rule,
        (teams) => criterion.evidenceOf(teams, ctx),
        null,
      );
      return ordered;
    }
    for (let i = 0; i < clusters.length - 1; i += 1) {
      const boundary = clusters[i]?.at(-1) ?? '';
      const next = clusters[i + 1]?.[0] ?? '';
      if (boundary !== '' && next !== '') {
        recordResolution(
          ctx,
          [boundary, next],
          criterion.rule,
          criterion.evidenceOf([boundary, next], ctx),
          null,
        );
      }
    }
    const resolved: string[] = [];
    for (const cluster of clusters) {
      if (cluster.length === 1) {
        resolved.push(cluster[0] ?? '');
      } else {
        resolved.push(...resolveTieGroup(ctx, cluster));
      }
    }
    return resolved;
  }
  const drawSeed = drawSeedOf(ctx, group);
  const rng = createRng(drawSeed);
  const drawn = [...group]
    .map((teamId) => ({ teamId, draw: rng.next() }))
    .sort((a, b) => a.draw - b.draw || (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0))
    .map((entry) => entry.teamId);
  recordWindows(
    ctx,
    drawn,
    'random-draw',
    () => [{ label: 'deciding rule', value: 'random-draw' }],
    drawSeed,
  );
  return drawn;
}
function rankConferenceOnce(ctx: RankContext, conference: SeasonConferenceId): string[] {
  const ids = franchisesInConference(ctx.league, conference);
  ids.sort((a, b) => {
    const aRow = ctx.rowOf.get(a);
    const bRow = ctx.rowOf.get(b);
    if (aRow === undefined || bRow === undefined) {
      throw new Error('tiebreak: missing standings row');
    }
    const byPct = compareWinPct(aRow.wins, aRow.losses, bRow.wins, bRow.losses);
    if (byPct !== 0) return byPct;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const ordered: string[] = [];
  let index = 0;
  while (index < ids.length) {
    const first = ids[index];
    if (first === undefined) break;
    const firstRow = ctx.rowOf.get(first);
    if (firstRow === undefined) throw new Error('tiebreak: missing standings row');
    let end = index + 1;
    while (end < ids.length) {
      const next = ids[end];
      const nextRow = next === undefined ? undefined : ctx.rowOf.get(next);
      if (
        nextRow === undefined ||
        nextRow.wins !== firstRow.wins ||
        nextRow.losses !== firstRow.losses
      ) {
        break;
      }
      end += 1;
    }
    if (end - index === 1) {
      ordered.push(first);
    } else {
      ordered.push(...resolveTieGroup(ctx, ids.slice(index, end)));
    }
    index = end;
  }
  return ordered;
}
function rankBothWith(
  ctx: RankContext,
  eastEligible: Set<string> | null,
  westEligible: Set<string> | null,
): {
  east: string[];
  west: string[];
} {
  const eastCtx: RankContext = {
    ...ctx,
    conference: 'east',
    sameEligible: eastEligible,
    oppositeEligible: westEligible,
  };
  const westCtx: RankContext = {
    ...ctx,
    conference: 'west',
    sameEligible: westEligible,
    oppositeEligible: eastEligible,
  };
  return { east: rankConferenceOnce(eastCtx, 'east'), west: rankConferenceOnce(westCtx, 'west') };
}
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const entry of a) {
    if (!b.has(entry)) return false;
  }
  return true;
}
function freshContext(league: SeasonLeague, standings: SeasonStandings, seed: string): RankContext {
  return {
    league,
    standings,
    rowOf: new Map(standings.rows.map((row) => [row.franchiseId, row])),
    sameEligible: null,
    oppositeEligible: null,
    resolutions: [],
    conference: 'east',
    seed,
  };
}
export function rankSeasonPostseason(
  league: SeasonLeague,
  standings: SeasonStandings,
  seed: string,
): SeasonPostseasonRankings {
  for (const team of league.teams) {
    if (!standings.rows.some((row) => row.franchiseId === team.franchiseId)) {
      throw new Error(`tiebreak: standings miss franchise ${team.franchiseId}`);
    }
  }
  let eastEligible: Set<string> | null = null;
  let westEligible: Set<string> | null = null;
  let order: {
    east: string[];
    west: string[];
  } | null = null;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    order = rankBothWith(freshContext(league, standings, seed), eastEligible, westEligible);
    const nextEast = new Set(order.east.slice(0, 10));
    const nextWest = new Set(order.west.slice(0, 10));
    if (
      eastEligible !== null &&
      westEligible !== null &&
      sameSet(eastEligible, nextEast) &&
      sameSet(westEligible, nextWest)
    ) {
      break;
    }
    eastEligible = nextEast;
    westEligible = nextWest;
  }
  if (order === null) {
    throw new Error('tiebreak: ranking failed to produce an order');
  }
  return {
    east: finishConference(league, standings, seed, 'east', eastEligible, westEligible, order.east),
    west: finishConference(league, standings, seed, 'west', westEligible, eastEligible, order.west),
  };
}
function finishConference(
  league: SeasonLeague,
  standings: SeasonStandings,
  seed: string,
  conference: SeasonConferenceId,
  sameEligible: Set<string> | null,
  oppositeEligible: Set<string> | null,
  expectedOrder: readonly string[],
): SeasonConferenceRanking {
  const ctx: RankContext = {
    ...freshContext(league, standings, seed),
    conference,
    sameEligible,
    oppositeEligible,
  };
  const resolved = rankConferenceOnce(ctx, conference);
  if (resolved.join('\u0000') !== expectedOrder.join('\u0000')) {
    throw new Error('tiebreak: final ranking pass diverged from the stable order');
  }
  const slotOf = new Map(resolved.map((franchiseId, index) => [franchiseId, index + 1]));
  const kept: SeasonTiebreakResolution[] = [];
  for (const resolution of ctx.resolutions) {
    const slots = resolution.teams
      .map((teamId) => slotOf.get(teamId) ?? 0)
      .filter((slot) => slot > 0)
      .sort((a, b) => a - b);
    if (slots.length === 0 || (slots[slots.length - 1] ?? 0) > 10) continue;
    const kind = slots.some((slot) => slot >= 7 && slot <= 10) ? 'qualification' : 'seeding';
    kept.push({ ...resolution, slots, kind });
  }
  return {
    conference,
    ranked: [...resolved],
    topTen: resolved.slice(0, 10),
    directSeeds: resolved.slice(0, 6),
    playInSeeds: resolved.slice(6, 10),
    resolutions: kept,
  };
}
