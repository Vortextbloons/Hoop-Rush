import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_PLAYOFF_ROUNDS,
  type FullCourtPlayerGameStats,
  type FullCourtPlayoffScore,
  type FullCourtSeasonScore,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import type { FullCourtStandings } from './standings.ts';

export interface FullCourtAwardsTeamInput {
  readonly teamId: string;
  readonly displayName: string;
  readonly roster: readonly SimulationPlayer[];
}

export interface FullCourtPlayerSeasonRow {
  readonly playerId: string;
  readonly playerVersionId?: string;
  readonly displayName: string;
  readonly positions: readonly string[];
  readonly teamId: string;
  readonly teamName: string;
  readonly games: number;
  readonly starts: number;
  readonly minutes: number;
  readonly mpg: number;
  readonly ppg: number;
  readonly rpg: number;
  readonly apg: number;
  readonly spg: number;
  readonly bpg: number;
  readonly topg: number;
  readonly tpmPg: number;
  readonly fgPct: number | null;
  readonly tpPct: number | null;
  readonly ftPct: number | null;
  readonly tsPct: number | null;
  readonly points: number;
  readonly rebounds: number;
  readonly offRebounds: number;
  readonly defRebounds: number;
  readonly assists: number;
  readonly steals: number;
  readonly blocks: number;
  readonly turnovers: number;
  readonly fouls: number;
  readonly fgm: number;
  readonly fga: number;
  readonly tpm: number;
  readonly tpa: number;
  readonly ftm: number;
  readonly fta: number;
  /** Hollinger-style per-game Game Score average for deterministic ranking. */
  readonly gameScorePg: number;
}

export interface FullCourtAwardCandidate {
  readonly player: FullCourtPlayerSeasonRow;
  readonly score: number;
  readonly summary: string;
}

export interface FullCourtAwardResult {
  readonly id: 'mvp' | 'dpoy' | 'sixth-man' | 'scoring-champ' | 'finals-mvp';
  readonly title: string;
  readonly subtitle: string;
  readonly winner: FullCourtAwardCandidate | null;
  readonly finalists: readonly FullCourtAwardCandidate[];
}

export interface FullCourtLeagueLeaders {
  readonly scoring: readonly FullCourtPlayerSeasonRow[];
  readonly rebounding: readonly FullCourtPlayerSeasonRow[];
  readonly assists: readonly FullCourtPlayerSeasonRow[];
  readonly steals: readonly FullCourtPlayerSeasonRow[];
  readonly blocks: readonly FullCourtPlayerSeasonRow[];
  readonly threes: readonly FullCourtPlayerSeasonRow[];
}

export interface FullCourtAwardsBoard {
  readonly regularComplete: boolean;
  readonly hasPlayerStats: boolean;
  readonly mvp: FullCourtAwardResult;
  readonly dpoy: FullCourtAwardResult;
  readonly sixthMan: FullCourtAwardResult;
  readonly scoringChamp: FullCourtAwardResult;
  readonly finalsMvp: FullCourtAwardResult;
  readonly allLeagueFirst: readonly FullCourtPlayerSeasonRow[];
  readonly allLeagueSecond: readonly FullCourtPlayerSeasonRow[];
  readonly leaders: FullCourtLeagueLeaders;
}

interface PlayerAccumulator {
  readonly player: SimulationPlayer;
  readonly teamId: string;
  readonly teamName: string;
  games: number;
  starts: number;
  seconds: number;
  points: number;
  rebounds: number;
  offRebounds: number;
  defRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
}

function roundTenth(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function pctOf(made: number, attempted: number): number | null {
  if (attempted <= 0) return null;
  return roundTenth((made / attempted) * 100);
}

function trueShootingPct(points: number, fga: number, fta: number): number | null {
  const denom = 2 * (fga + 0.44 * fta);
  if (denom <= 0) return null;
  return roundTenth((points / denom) * 100);
}

function gameScoreTotal(acc: PlayerAccumulator): number {
  return (
    acc.points +
    0.4 * acc.fgm -
    0.7 * acc.fga -
    0.4 * (acc.fta - acc.ftm) +
    0.7 * acc.offRebounds +
    0.3 * acc.defRebounds +
    acc.steals +
    0.7 * acc.assists +
    0.7 * acc.blocks -
    0.4 * acc.fouls -
    acc.turnovers
  );
}

function toRow(acc: PlayerAccumulator): FullCourtPlayerSeasonRow {
  const gp = Math.max(1, acc.games);
  const minutes = acc.seconds / 60;
  return {
    playerId: acc.player.playerId,
    ...(acc.player.playerVersionId === undefined
      ? {}
      : { playerVersionId: acc.player.playerVersionId }),
    displayName: acc.player.displayName,
    positions: acc.player.positions,
    teamId: acc.teamId,
    teamName: acc.teamName,
    games: acc.games,
    starts: acc.starts,
    minutes: roundTenth(minutes),
    mpg: acc.games === 0 ? 0 : roundTenth(minutes / gp),
    ppg: acc.games === 0 ? 0 : roundTenth(acc.points / gp),
    rpg: acc.games === 0 ? 0 : roundTenth(acc.rebounds / gp),
    apg: acc.games === 0 ? 0 : roundTenth(acc.assists / gp),
    spg: acc.games === 0 ? 0 : roundTenth(acc.steals / gp),
    bpg: acc.games === 0 ? 0 : roundTenth(acc.blocks / gp),
    topg: acc.games === 0 ? 0 : roundTenth(acc.turnovers / gp),
    tpmPg: acc.games === 0 ? 0 : roundTenth(acc.tpm / gp),
    fgPct: pctOf(acc.fgm, acc.fga),
    tpPct: pctOf(acc.tpm, acc.tpa),
    ftPct: pctOf(acc.ftm, acc.fta),
    tsPct: trueShootingPct(acc.points, acc.fga, acc.fta),
    points: acc.points,
    rebounds: acc.rebounds,
    offRebounds: acc.offRebounds,
    defRebounds: acc.defRebounds,
    assists: acc.assists,
    steals: acc.steals,
    blocks: acc.blocks,
    turnovers: acc.turnovers,
    fouls: acc.fouls,
    fgm: acc.fgm,
    fga: acc.fga,
    tpm: acc.tpm,
    tpa: acc.tpa,
    ftm: acc.ftm,
    fta: acc.fta,
    gameScorePg: acc.games === 0 ? 0 : roundTenth(gameScoreTotal(acc) / gp),
  };
}

function addStatLine(acc: PlayerAccumulator, line: FullCourtPlayerGameStats): void {
  if (line.seconds <= 0 && line.points === 0) return;
  acc.games += 1;
  if (line.started) acc.starts += 1;
  acc.seconds += line.seconds;
  acc.points += line.points;
  acc.rebounds += line.rebounds;
  acc.offRebounds += line.offRebounds;
  acc.defRebounds += line.defRebounds;
  acc.assists += line.assists;
  acc.steals += line.steals;
  acc.blocks += line.blocks;
  acc.turnovers += line.turnovers;
  acc.fouls += line.fouls;
  acc.fgm += line.fgm;
  acc.fga += line.fga;
  acc.tpm += line.tpm;
  acc.tpa += line.tpa;
  acc.ftm += line.ftm;
  acc.fta += line.fta;
}

type ScoreLike = Pick<FullCourtSeasonScore, 'homeTeamId' | 'awayTeamId' | 'outcome'>;

export function buildFullCourtPlayerSeasonStats(input: {
  readonly teams: readonly FullCourtAwardsTeamInput[];
  readonly scores: readonly ScoreLike[];
}): FullCourtPlayerSeasonRow[] {
  const accumulators = new Map<string, PlayerAccumulator>();
  const keyOf = (teamId: string, playerId: string) => `${teamId}::${playerId}`;

  for (const team of input.teams) {
    for (const player of team.roster) {
      accumulators.set(keyOf(team.teamId, player.playerId), {
        player,
        teamId: team.teamId,
        teamName: team.displayName,
        games: 0,
        starts: 0,
        seconds: 0,
        points: 0,
        rebounds: 0,
        offRebounds: 0,
        defRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        fgm: 0,
        fga: 0,
        tpm: 0,
        tpa: 0,
        ftm: 0,
        fta: 0,
      });
    }
  }

  for (const score of input.scores) {
    if (score.outcome.kind !== 'played' || score.outcome.playerStats === undefined) continue;
    for (const line of score.outcome.playerStats.home) {
      const acc = accumulators.get(keyOf(score.homeTeamId, line.playerId));
      if (acc !== undefined) addStatLine(acc, line);
    }
    for (const line of score.outcome.playerStats.away) {
      const acc = accumulators.get(keyOf(score.awayTeamId, line.playerId));
      if (acc !== undefined) addStatLine(acc, line);
    }
  }

  return [...accumulators.values()]
    .map(toRow)
    .sort(
      (a, b) =>
        b.ppg - a.ppg || b.gameScorePg - a.gameScorePg || a.playerId.localeCompare(b.playerId),
    );
}

function rankCandidates(
  rows: readonly FullCourtPlayerSeasonRow[],
  scoreOf: (row: FullCourtPlayerSeasonRow) => number,
  summaryOf: (row: FullCourtPlayerSeasonRow) => string,
  limit = 3,
): FullCourtAwardCandidate[] {
  return [...rows]
    .map((player) => ({
      player,
      score: roundTenth(scoreOf(player)),
      summary: summaryOf(player),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.player.gameScorePg - a.player.gameScorePg ||
        a.player.playerId.localeCompare(b.player.playerId),
    )
    .slice(0, limit);
}

function topLeaders(
  rows: readonly FullCourtPlayerSeasonRow[],
  metric: (row: FullCourtPlayerSeasonRow) => number,
  limit = 5,
): FullCourtPlayerSeasonRow[] {
  return [...rows]
    .sort(
      (a, b) => metric(b) - metric(a) || b.games - a.games || a.playerId.localeCompare(b.playerId),
    )
    .slice(0, limit);
}

export function buildFullCourtAwards(input: {
  readonly teams: readonly FullCourtAwardsTeamInput[];
  readonly regularScores: readonly FullCourtSeasonScore[];
  readonly standings: FullCourtStandings;
  readonly completedSlots: number;
  readonly playoffGames?: readonly FullCourtPlayoffScore[];
  readonly championTeamId?: string | null;
}): FullCourtAwardsBoard {
  const regularComplete = input.completedSlots >= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM;
  const rows = buildFullCourtPlayerSeasonStats({
    teams: input.teams,
    scores: input.regularScores,
  });
  const activeRows = rows.filter((row) => row.games > 0);
  const hasPlayerStats = activeRows.length > 0;

  const standingsByTeam = new Map(
    [...input.standings.west, ...input.standings.east].map((row) => [row.teamId, row]),
  );
  const playerByTeamAndId = new Map<string, SimulationPlayer>();
  for (const team of input.teams) {
    for (const player of team.roster) {
      playerByTeamAndId.set(`${team.teamId}::${player.playerId}`, player);
    }
  }

  const maxGames = Math.max(1, ...activeRows.map((row) => row.games));
  const minQualifiedGames = Math.max(1, Math.floor(maxGames * 0.55));
  const qualified = activeRows.filter((row) => row.games >= minQualifiedGames && row.mpg >= 14);
  const pool = qualified.length > 0 ? qualified : activeRows;

  const mvpCandidates = rankCandidates(
    pool,
    (row) => {
      const team = standingsByTeam.get(row.teamId);
      const winPct = team === undefined ? 0.5 : team.wins / Math.max(1, team.wins + team.losses);
      const tsBonus = row.tsPct === null ? 0 : (row.tsPct - 54) * 0.25;
      return row.gameScorePg * 1.45 + winPct * 18 + tsBonus;
    },
    (row) => `${row.ppg.toFixed(1)} PPG · ${row.rpg.toFixed(1)} RPG · ${row.apg.toFixed(1)} APG`,
  );

  const dpoyCandidates = rankCandidates(
    pool,
    (row) => {
      const team = standingsByTeam.get(row.teamId);
      const winPct = team === undefined ? 0.5 : team.wins / Math.max(1, team.wins + team.losses);
      const simPlayer = playerByTeamAndId.get(`${row.teamId}::${row.playerId}`);
      const defRating =
        simPlayer === undefined
          ? 70
          : (simPlayer.ratings.perimeterDefense + simPlayer.ratings.interiorDefense) / 2;
      const defRebPg = row.defRebounds / Math.max(1, row.games);
      return row.spg * 4.5 + row.bpg * 4.5 + defRebPg * 0.8 + defRating * 0.14 + winPct * 6;
    },
    (row) => `${row.spg.toFixed(1)} SPG · ${row.bpg.toFixed(1)} BPG · ${row.rpg.toFixed(1)} RPG`,
  );

  const sixthManPool = pool.filter((row) => row.starts / Math.max(1, row.games) < 0.5);
  const sixthManCandidates = rankCandidates(
    sixthManPool,
    (row) => {
      const team = standingsByTeam.get(row.teamId);
      const winPct = team === undefined ? 0.5 : team.wins / Math.max(1, team.wins + team.losses);
      return row.ppg * 1.15 + row.apg * 0.8 + row.rpg * 0.5 + row.gameScorePg * 0.6 + winPct * 5;
    },
    (row) => `${row.ppg.toFixed(1)} PPG · ${row.apg.toFixed(1)} APG off the bench`,
  );

  const scoringChampCandidates = rankCandidates(
    pool,
    (row) => row.ppg,
    (row) => `${row.ppg.toFixed(1)} PPG (${row.tsPct?.toFixed(1) ?? '—'}% TS)`,
  );

  const allLeagueRanked = rankCandidates(
    pool,
    (row) => {
      const team = standingsByTeam.get(row.teamId);
      const winPct = team === undefined ? 0.5 : team.wins / Math.max(1, team.wins + team.losses);
      return row.gameScorePg * 1.4 + winPct * 12;
    },
    (row) => `${row.ppg.toFixed(1)} PPG`,
    10,
  ).map((candidate) => candidate.player);

  let finalsMvpCandidates: FullCourtAwardCandidate[] = [];
  if (input.championTeamId && input.playoffGames && input.playoffGames.length > 0) {
    const finalsPrefix = `fcp-${String(CAP_RUSH_PLAYOFF_ROUNDS)}-`;
    const finalsGames = input.playoffGames.filter((game) => game.gameId.startsWith(finalsPrefix));
    const championTeam = input.teams.find((team) => team.teamId === input.championTeamId);
    if (championTeam !== undefined && finalsGames.length > 0) {
      const finalsRows = buildFullCourtPlayerSeasonStats({
        teams: [championTeam],
        scores: finalsGames,
      }).filter((row) => row.games > 0);
      finalsMvpCandidates = rankCandidates(
        finalsRows,
        (row) => row.gameScorePg * 1.5 + row.ppg * 0.35,
        (row) =>
          `${row.ppg.toFixed(1)} PPG · ${row.rpg.toFixed(1)} RPG · ${row.apg.toFixed(1)} APG in Finals`,
      );
    }
  }

  return {
    regularComplete,
    hasPlayerStats,
    mvp: {
      id: 'mvp',
      title: 'Most Valuable Player',
      subtitle: regularComplete ? 'Regular season MVP' : 'Live MVP race',
      winner: mvpCandidates[0] ?? null,
      finalists: mvpCandidates,
    },
    dpoy: {
      id: 'dpoy',
      title: 'Defensive Player of the Year',
      subtitle: regularComplete ? 'Top two-way stopper' : 'Live DPOY race',
      winner: dpoyCandidates[0] ?? null,
      finalists: dpoyCandidates,
    },
    sixthMan: {
      id: 'sixth-man',
      title: 'Sixth Man of the Year',
      subtitle: regularComplete ? 'Top bench spark' : 'Live Sixth Man race',
      winner: sixthManCandidates[0] ?? null,
      finalists: sixthManCandidates,
    },
    scoringChamp: {
      id: 'scoring-champ',
      title: 'Scoring Champion',
      subtitle: regularComplete ? 'Points per game leader' : 'Scoring race',
      winner: scoringChampCandidates[0] ?? null,
      finalists: scoringChampCandidates,
    },
    finalsMvp: {
      id: 'finals-mvp',
      title: 'Finals MVP',
      subtitle: input.championTeamId ? 'Championship series MVP' : 'Awarded after the Finals',
      winner: finalsMvpCandidates[0] ?? null,
      finalists: finalsMvpCandidates,
    },
    allLeagueFirst: allLeagueRanked.slice(0, 5),
    allLeagueSecond: allLeagueRanked.slice(5, 10),
    leaders: {
      scoring: topLeaders(pool, (row) => row.ppg),
      rebounding: topLeaders(pool, (row) => row.rpg),
      assists: topLeaders(pool, (row) => row.apg),
      steals: topLeaders(pool, (row) => row.spg),
      blocks: topLeaders(pool, (row) => row.bpg),
      threes: topLeaders(pool, (row) => row.tpmPg),
    },
  };
}
