import type {
  CollectionGameRecordUnion,
  CollectionGameResultUnion,
} from '@hoop-rush/data-contracts';

export type CollectionCompletedResult = Extract<
  CollectionGameResultUnion,
  { outcome: 'completed' }
>;

export interface ShootingSplit {
  made: number;
  attempted: number;
}

export interface PlayerBoxInput {
  cardId: string;
  seconds: number;
  minutes: number;
  points: number;
  rebounds: { total: number; offensive: number; defensive: number };
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fieldGoals: ShootingSplit;
  threes: ShootingSplit;
  freeThrows: ShootingSplit;
  deepFours?: ShootingSplit;
}

export interface TeamBoxInput {
  score: number;
  players: readonly PlayerBoxInput[];
  box: {
    points: number;
    fieldGoals: ShootingSplit;
    threes: ShootingSplit;
    freeThrows: ShootingSplit;
    deepFours?: ShootingSplit;
    rebounds: { total: number; offensive: number; defensive: number; team: number };
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    fouls: number;
    possessions: number;
  };
}

export interface PlayerBoxRow {
  cardId: string;
  seconds: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fieldGoals: ShootingSplit;
  threes: ShootingSplit;
  freeThrows: ShootingSplit;
  deepFours: ShootingSplit | null;
  starter: boolean;
}

export interface TeamBoxTotals {
  points: number;
  fieldGoals: ShootingSplit;
  threes: ShootingSplit;
  freeThrows: ShootingSplit;
  deepFours: ShootingSplit | null;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  possessions: number;
}

export interface TeamBoxView {
  score: number;
  players: PlayerBoxRow[];
  totals: TeamBoxTotals;
  startersPoints: number;
  benchPoints: number;
}

export interface TeamStatCell {
  primary: string;
  detail: string | null;
}

export interface TeamStatRow {
  key: string;
  label: string;
  home: TeamStatCell;
  away: TeamStatCell;
  homeShare: number;
  leader: 'home' | 'away' | 'tie' | 'neutral';
}

function splitOf(split: ShootingSplit): ShootingSplit {
  return { made: split.made, attempted: split.attempted };
}

export function percentOf(made: number, attempted: number): number {
  return attempted > 0 ? made / attempted : 0;
}

export function percentText(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function trueShootingOf(
  points: number,
  fieldGoalAttempts: number,
  freeThrowAttempts: number,
): number {
  const shots = fieldGoalAttempts + 0.44 * freeThrowAttempts;
  return shots > 0 ? points / (2 * shots) : 0;
}

export function startersOf(record: CollectionGameRecordUnion): {
  home: readonly string[];
  away: readonly string[];
} {
  return {
    home: record.prepared.playerTeam.starters,
    away: record.prepared.cpuTeam.starters,
  };
}

export function playerRowsOf(
  players: readonly PlayerBoxInput[],
  starterIds: readonly string[],
): PlayerBoxRow[] {
  const starters = new Set(starterIds);
  return players
    .map((player) => ({
      cardId: player.cardId,
      seconds: player.seconds,
      minutes: player.minutes,
      points: player.points,
      rebounds: player.rebounds.total,
      assists: player.assists,
      steals: player.steals,
      blocks: player.blocks,
      turnovers: player.turnovers,
      fouls: player.fouls,
      fieldGoals: splitOf(player.fieldGoals),
      threes: splitOf(player.threes),
      freeThrows: splitOf(player.freeThrows),
      deepFours: player.deepFours === undefined ? null : splitOf(player.deepFours),
      starter: starters.has(player.cardId),
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

export function teamBoxViewOf(input: {
  result: TeamBoxInput;
  starterIds: readonly string[];
}): TeamBoxView {
  const players = playerRowsOf(input.result.players, input.starterIds);
  let startersPoints = 0;
  let benchPoints = 0;
  for (const player of players) {
    if (player.starter) startersPoints += player.points;
    else benchPoints += player.points;
  }
  const { box } = input.result;
  return {
    score: input.result.score,
    players,
    startersPoints,
    benchPoints,
    totals: {
      points: box.points,
      fieldGoals: splitOf(box.fieldGoals),
      threes: splitOf(box.threes),
      freeThrows: splitOf(box.freeThrows),
      deepFours: box.deepFours === undefined ? null : splitOf(box.deepFours),
      rebounds: box.rebounds.total,
      offensiveRebounds: box.rebounds.offensive,
      defensiveRebounds: box.rebounds.defensive,
      assists: box.assists,
      steals: box.steals,
      blocks: box.blocks,
      turnovers: box.turnovers,
      fouls: box.fouls,
      possessions: box.possessions,
    },
  };
}

function statRow(input: {
  key: string;
  label: string;
  homeValue: number;
  awayValue: number;
  home: TeamStatCell;
  away: TeamStatCell;
  lowerIsBetter?: boolean;
  neutral?: boolean;
}): TeamStatRow {
  const total = input.homeValue + input.awayValue;
  let leader: TeamStatRow['leader'];
  if (input.neutral) {
    leader = 'neutral';
  } else if (Math.abs(input.homeValue - input.awayValue) < 1e-9) {
    leader = 'tie';
  } else {
    const homeHigher = input.homeValue > input.awayValue;
    leader = homeHigher !== (input.lowerIsBetter ?? false) ? 'home' : 'away';
  }
  return {
    key: input.key,
    label: input.label,
    home: input.home,
    away: input.away,
    homeShare: total > 0 ? input.homeValue / total : 0.5,
    leader,
  };
}

function shootingCell(split: ShootingSplit): TeamStatCell {
  if (split.attempted === 0) return { primary: '—', detail: null };
  return {
    primary: percentText(percentOf(split.made, split.attempted)),
    detail: `${String(split.made)}-${String(split.attempted)}`,
  };
}

function countCell(value: number, detail: string | null = null): TeamStatCell {
  return { primary: String(value), detail };
}

export function teamComparisonOf(home: TeamBoxView, away: TeamBoxView): TeamStatRow[] {
  const rows: TeamStatRow[] = [];
  const shootingRow = (
    key: string,
    label: string,
    homeSplit: ShootingSplit,
    awaySplit: ShootingSplit,
  ): TeamStatRow =>
    statRow({
      key,
      label,
      homeValue: percentOf(homeSplit.made, homeSplit.attempted),
      awayValue: percentOf(awaySplit.made, awaySplit.attempted),
      home: shootingCell(homeSplit),
      away: shootingCell(awaySplit),
    });
  rows.push(shootingRow('fg', 'Field goals', home.totals.fieldGoals, away.totals.fieldGoals));
  rows.push(shootingRow('3p', '3-pointers', home.totals.threes, away.totals.threes));
  rows.push(shootingRow('ft', 'Free throws', home.totals.freeThrows, away.totals.freeThrows));
  const homeTrueShooting = trueShootingOf(
    home.totals.points,
    home.totals.fieldGoals.attempted,
    home.totals.freeThrows.attempted,
  );
  const awayTrueShooting = trueShootingOf(
    away.totals.points,
    away.totals.fieldGoals.attempted,
    away.totals.freeThrows.attempted,
  );
  rows.push(
    statRow({
      key: 'ts',
      label: 'True shooting',
      homeValue: homeTrueShooting,
      awayValue: awayTrueShooting,
      home: { primary: percentText(homeTrueShooting), detail: null },
      away: { primary: percentText(awayTrueShooting), detail: null },
    }),
  );
  rows.push(
    statRow({
      key: 'reb',
      label: 'Rebounds',
      homeValue: home.totals.rebounds,
      awayValue: away.totals.rebounds,
      home: countCell(
        home.totals.rebounds,
        `${String(home.totals.offensiveRebounds)} off · ${String(home.totals.defensiveRebounds)} def`,
      ),
      away: countCell(
        away.totals.rebounds,
        `${String(away.totals.offensiveRebounds)} off · ${String(away.totals.defensiveRebounds)} def`,
      ),
    }),
  );
  rows.push(
    statRow({
      key: 'ast',
      label: 'Assists',
      homeValue: home.totals.assists,
      awayValue: away.totals.assists,
      home: countCell(home.totals.assists),
      away: countCell(away.totals.assists),
    }),
  );
  rows.push(
    statRow({
      key: 'stl',
      label: 'Steals',
      homeValue: home.totals.steals,
      awayValue: away.totals.steals,
      home: countCell(home.totals.steals),
      away: countCell(away.totals.steals),
    }),
  );
  rows.push(
    statRow({
      key: 'blk',
      label: 'Blocks',
      homeValue: home.totals.blocks,
      awayValue: away.totals.blocks,
      home: countCell(home.totals.blocks),
      away: countCell(away.totals.blocks),
    }),
  );
  rows.push(
    statRow({
      key: 'tov',
      label: 'Turnovers',
      lowerIsBetter: true,
      homeValue: home.totals.turnovers,
      awayValue: away.totals.turnovers,
      home: countCell(home.totals.turnovers),
      away: countCell(away.totals.turnovers),
    }),
  );
  rows.push(
    statRow({
      key: 'pf',
      label: 'Team fouls',
      lowerIsBetter: true,
      homeValue: home.totals.fouls,
      awayValue: away.totals.fouls,
      home: countCell(home.totals.fouls),
      away: countCell(away.totals.fouls),
    }),
  );
  rows.push(
    statRow({
      key: 'poss',
      label: 'Possessions',
      neutral: true,
      homeValue: home.totals.possessions,
      awayValue: away.totals.possessions,
      home: countCell(home.totals.possessions),
      away: countCell(away.totals.possessions),
    }),
  );
  rows.push(
    statRow({
      key: 'bench',
      label: 'Bench points',
      homeValue: home.benchPoints,
      awayValue: away.benchPoints,
      home: countCell(home.benchPoints),
      away: countCell(away.benchPoints),
    }),
  );
  return rows;
}
