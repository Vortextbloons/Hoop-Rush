import type {
  SeasonGameSummary,
  SeasonRotation,
  SeasonTeamAggregate,
} from '@hoop-rush/data-contracts';
import type { SeriesCardViewModel } from './season-postseason-presentation';
import { didWin, foldSeasonAggregates } from './season-presentation';

export interface PlayoffTeamStatRow {
  key: string;
  label: string;
  homeValue: number;
  awayValue: number;
  homeDisplay: string;
  awayDisplay: string;
  leader: 'home' | 'away' | 'tie';
}

export interface PlayoffEdgeNote {
  tone: 'you' | 'them' | 'watch';
  label: string;
  detail: string;
}

export interface PlayoffSnapshot {
  homeFranchiseId: string;
  awayFranchiseId: string;
  rows: PlayoffTeamStatRow[];
  edges: PlayoffEdgeNote[];
  seasonSeries: { homeWins: number; awayWins: number; label: string };
  homeForm: string;
  awayForm: string;
}

export interface PlayoffPrepSummary {
  minutesTotal: number;
  minutesOk: boolean;
  closersSet: number;
  closersOk: boolean;
  startersLabel: string;
  rotationLabel: string;
  invalid: boolean;
  firstFailure: string | null;
}

function perGame(total: number, games: number): number {
  return games > 0 ? total / games : 0;
}

function trueShootingOf(agg: SeasonTeamAggregate): number {
  const denom = 2 * (agg.fieldGoalsAttempted + 0.44 * agg.freeThrowsAttempted);
  return denom > 0 ? agg.points / denom : 0;
}

function lastN(
  summaries: readonly SeasonGameSummary[],
  franchiseId: string,
  count: number,
): SeasonGameSummary[] {
  return summaries
    .filter((s) => s.homeFranchiseId === franchiseId || s.awayFranchiseId === franchiseId)
    .sort((a, b) => a.round - b.round)
    .slice(-count);
}

function formLabel(games: SeasonGameSummary[], franchiseId: string): string {
  if (games.length === 0) return 'No games yet';
  return games
    .map((g) => (didWin(g, franchiseId) ? 'W' : 'L'))
    .join(' ');
}

function headToHead(
  summaries: readonly SeasonGameSummary[],
  homeId: string,
  awayId: string,
): { homeWins: number; awayWins: number } {
  let homeWins = 0;
  let awayWins = 0;
  for (const s of summaries) {
    const involves =
      (s.homeFranchiseId === homeId && s.awayFranchiseId === awayId) ||
      (s.homeFranchiseId === awayId && s.awayFranchiseId === homeId);
    if (!involves) continue;
    if (didWin(s, homeId)) homeWins += 1;
    else awayWins += 1;
  }
  return { homeWins, awayWins };
}

function rowOf(
  key: string,
  label: string,
  homeValue: number,
  awayValue: number,
  format: (v: number) => string,
  higherWins = true,
): PlayoffTeamStatRow {
  const leader =
    Math.abs(homeValue - awayValue) < 1e-9 ? 'tie' : homeValue > awayValue === higherWins ? 'home' : 'away';
  return { key, label, homeValue, awayValue, homeDisplay: format(homeDisplay(homeValue)), awayDisplay: format(awayDisplay(awayValue)), leader };
  function homeDisplay(v: number): number {
    return v;
  }
  function awayDisplay(v: number): number {
    return v;
  }
}

const oneDecimal = (v: number): string => v.toFixed(1);
const pct1 = (v: number): string => `${(v * 100).toFixed(1)}%`;

export function playoffSnapshotOf(input: {
  series: SeriesCardViewModel;
  summaries: readonly SeasonGameSummary[];
  aggregates?: readonly SeasonTeamAggregate[];
}): PlayoffSnapshot | null {
  const { series, summaries } = input;
  const homeId = series.homeFranchiseId;
  const awayId = series.awayFranchiseId;
  if (homeId === null || awayId === null) return null;
  const aggs = input.aggregates ?? foldSeasonAggregates(summaries).teams;
  const byId = new Map<string, SeasonTeamAggregate>(aggs.map((a) => [a.franchiseId, a]));
  const home = byId.get(homeId);
  const away = byId.get(awayId);
  if (home === undefined || away === undefined) return null;

  const rows: PlayoffTeamStatRow[] = [
    rowOf('ppg', 'PPG', perGame(home.points, home.gamesPlayed), perGame(away.points, away.gamesPlayed), oneDecimal),
    rowOf('ts', 'TS%', trueShootingOf(home), trueShootingOf(away), pct1),
    rowOf(
      '3p',
      '3P%',
      home.threePointersAttempted > 0 ? home.threePointersMade / home.threePointersAttempted : 0,
      away.threePointersAttempted > 0 ? away.threePointersMade / away.threePointersAttempted : 0,
      pct1,
    ),
    rowOf(
      'reb',
      'REB',
      perGame(home.offensiveRebounds + home.defensiveRebounds, home.gamesPlayed),
      perGame(away.offensiveRebounds + away.defensiveRebounds, away.gamesPlayed),
      oneDecimal,
    ),
    rowOf(
      'oreb',
      'OREB',
      perGame(home.offensiveRebounds, home.gamesPlayed),
      perGame(away.offensiveRebounds, away.gamesPlayed),
      oneDecimal,
    ),
  ];

  const h2h = headToHead(summaries, homeId, awayId);
  const seasonSeries = {
    ...h2h,
    label:
      h2h.homeWins === 0 && h2h.awayWins === 0
        ? 'Did not meet in the regular season'
        : `Season series ${String(h2h.homeWins)}–${String(h2h.awayWins)}`,
  };

  const homeForm = formLabel(lastN(summaries, homeId, 5), homeId);
  const awayForm = formLabel(lastN(summaries, awayId, 5), awayId);

  const edges: PlayoffEdgeNote[] = [];
  const find = (key: string): PlayoffTeamStatRow | undefined => rows.find((r) => r.key === key);
  const ppg = find('ppg');
  const ts = find('ts');
  const oreb = find('oreb');
  const reb = find('reb');
  if (ppg !== undefined && ppg.leader !== 'tie' && Math.abs(ppg.homeValue - ppg.awayValue) >= 1.5) {
    edges.push({
      tone: 'watch',
      label: `Scoring gap ${ppg.homeDisplay}–${ppg.awayDisplay}`,
      detail: 'Per-game scoring from completed regular-season games.',
    });
  }
  if (ts !== undefined && ts.leader !== 'tie' && Math.abs(ts.homeValue - ts.awayValue) >= 0.015) {
    edges.push({
      tone: 'watch',
      label: `Efficiency gap ${ts.homeDisplay} vs ${ts.awayDisplay}`,
      detail: 'True shooting from completed regular-season games.',
    });
  }
  if (oreb !== undefined && oreb.leader !== 'tie' && Math.abs(oreb.homeValue - oreb.awayValue) >= 0.8) {
    edges.push({
      tone: 'watch',
      label: `Glass gap ${oreb.homeDisplay}–${oreb.awayDisplay} OREB`,
      detail: 'Offensive boards per game create extra possessions.',
    });
  } else if (reb !== undefined && reb.leader !== 'tie' && Math.abs(reb.homeValue - reb.awayValue) >= 1.5) {
    edges.push({
      tone: 'watch',
      label: `Rebound gap ${reb.homeDisplay}–${reb.awayDisplay}`,
      detail: 'Total boards per game from completed games.',
    });
  }
  return { homeFranchiseId: homeId, awayFranchiseId: awayId, rows, edges: edges.slice(0, 3), seasonSeries, homeForm, awayForm };
}

export function playoffPrepSummaryOf(input: {
  rotation: SeasonRotation;
  failures: readonly string[];
  nameOf: (playerVersionId: string) => string;
}): PlayoffPrepSummary {
  const minutesTotal = input.rotation.targetMinutes.reduce((sum, t) => sum + t.minutes, 0);
  const closersSet = new Set(input.rotation.closingFive).size;
  const minuteById = new Map(input.rotation.targetMinutes.map((t) => [t.playerVersionId, t.minutes]));
  const starters = input.rotation.starters.map((id) => {
    const name = input.nameOf(id);
    const minutes = minuteById.get(id) ?? 0;
    const short = name.split(' ').slice(-1)[0] ?? name;
    return `${short} ${String(minutes)}`;
  });
  return {
    minutesTotal,
    minutesOk: minutesTotal === 240,
    closersSet,
    closersOk: closersSet === 5,
    startersLabel: starters.join(' · '),
    rotationLabel: `${String(minutesTotal)}/240 min · ${String(closersSet)}/5 closers`,
    invalid: input.failures.length > 0,
    firstFailure: input.failures[0] ?? null,
  };
}
