import {
  capRushConferenceRoundName,
  type FullCourtPlayerGameStats,
  type FullCourtPlayoffScore,
  type FullCourtSeasonScore,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import type { FullCourtGameResult, FullCourtPlayerLine } from './game.ts';
import type { FullCourtPlayoffSeries } from './playoffs.ts';

export type FullCourtNotableMomentCategory =
  | 'triple-double'
  | 'five-by-five'
  | 'scoring'
  | 'efficiency'
  | 'playmaking'
  | 'defense-glass'
  | 'team-game';

export type FullCourtNotableMomentTier = 'historic' | 'standout' | 'notable';

export interface FullCourtNotableMoment {
  readonly id: string;
  readonly gameId: string;
  readonly phase: 'regular' | 'playoffs';
  readonly gameNumber: number;
  readonly gameLabel: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly opponentTeamId: string;
  readonly opponentTeamName: string;
  readonly userInvolved: boolean;
  readonly isUserPlayerOrTeam: boolean;
  readonly playerId: string | null;
  readonly playerName: string | null;
  readonly category: FullCourtNotableMomentCategory;
  readonly tier: FullCourtNotableMomentTier;
  readonly headline: string;
  readonly statLine: string;
  readonly scoreLabel: string;
  readonly won: boolean;
  readonly rankScore: number;
}

export interface FullCourtNotableMomentsSummary {
  readonly userMoments: readonly FullCourtNotableMoment[];
  readonly leagueMoments: readonly FullCourtNotableMoment[];
  readonly byGameId: ReadonlyMap<string, readonly FullCourtNotableMoment[]>;
}

export interface FullCourtMomentsTeamInput {
  readonly teamId: string;
  readonly displayName: string;
  readonly roster: readonly Pick<SimulationPlayer, 'playerId' | 'displayName'>[];
}

const MAX_MOMENTS_PER_GAME = 2;
const DEFAULT_LEAGUE_MOMENTS_LIMIT = 15;

function trueShootingPct(points: number, fga: number, fta: number): number | null {
  const denominator = 2 * (fga + 0.44 * fta);
  return denominator > 0 ? (points / denominator) * 100 : null;
}

function statLineFromBox(
  line: FullCourtPlayerGameStats,
  options: {
    readonly includeShooting?: boolean;
    readonly includeTs?: boolean;
    readonly includeThrees?: boolean;
    readonly includeStocks?: boolean;
    readonly includeTurnovers?: boolean;
  } = {},
): string {
  const parts: string[] = [`${String(line.points)} PTS`];
  if (line.rebounds >= 6 || options.includeStocks) {
    parts.push(`${String(line.rebounds)} REB`);
  }
  if (line.assists >= 5) {
    parts.push(`${String(line.assists)} AST`);
  }
  if (options.includeStocks || line.steals >= 4) {
    if (line.steals > 0) parts.push(`${String(line.steals)} STL`);
  }
  if (options.includeStocks || line.blocks >= 4) {
    if (line.blocks > 0) parts.push(`${String(line.blocks)} BLK`);
  }
  if (options.includeTurnovers) {
    parts.push(`${String(line.turnovers)} TOV`);
  }
  if (options.includeThrees && line.tpa > 0) {
    parts.push(`${String(line.tpm)}-${String(line.tpa)} 3P`);
  }
  if (options.includeShooting && line.fga > 0) {
    parts.push(`${String(line.fgm)}-${String(line.fga)} FG`);
  }
  if (options.includeTs) {
    const ts = trueShootingPct(line.points, line.fga, line.fta);
    if (ts !== null) parts.push(`${ts.toFixed(1)}% TS`);
  }
  return parts.join(' · ');
}

interface CandidateFeat {
  readonly category: FullCourtNotableMomentCategory;
  readonly tier: FullCourtNotableMomentTier;
  readonly headline: string;
  readonly statLine: string;
  readonly rankScore: number;
}

function evaluatePlayerMoment(line: FullCourtPlayerGameStats): CandidateFeat | null {
  if (line.seconds <= 0 && line.points <= 0) return null;

  const cats = [line.points, line.rebounds, line.assists, line.steals, line.blocks];
  const doubleDigitCats = cats.filter((value) => value >= 10).length;
  const fifteenPlusCats = cats.filter((value) => value >= 15).length;
  const twentyPlusCats = cats.filter((value) => value >= 20).length;
  const fivePlusCats = cats.filter((value) => value >= 5).length;
  const ts = trueShootingPct(line.points, line.fga, line.fta);
  const threePct = line.tpa > 0 ? line.tpm / line.tpa : 0;
  const stocks = line.steals + line.blocks;

  const candidates: CandidateFeat[] = [];

  if (doubleDigitCats >= 4) {
    candidates.push({
      category: 'triple-double',
      tier: 'historic',
      headline: 'Quadruple-Double',
      statLine: statLineFromBox(line, { includeStocks: true }),
      rankScore: 240 + line.points + line.rebounds + line.assists + stocks,
    });
  } else if (fivePlusCats === 5) {
    candidates.push({
      category: 'five-by-five',
      tier: 'historic',
      headline: '5×5 Showcase',
      statLine: `${String(line.points)} PTS · ${String(line.rebounds)} REB · ${String(line.assists)} AST · ${String(line.steals)} STL · ${String(line.blocks)} BLK`,
      rankScore: 210 + line.points + line.rebounds + line.assists + stocks,
    });
  } else if (doubleDigitCats >= 3) {
    const historicTd = line.points >= 35 || twentyPlusCats >= 1 || fifteenPlusCats >= 2;
    candidates.push({
      category: 'triple-double',
      tier: historicTd ? 'historic' : 'standout',
      headline:
        line.points >= 40
          ? '40-Point Triple-Double'
          : historicTd
            ? 'Monster Triple-Double'
            : 'Triple-Double',
      statLine: `${String(line.points)} PTS · ${String(line.rebounds)} REB · ${String(line.assists)} AST${
        ts !== null && ts >= 65 ? ` · ${ts.toFixed(1)}% TS` : ''
      }`,
      rankScore:
        (historicTd ? 160 : 115) +
        line.points +
        line.rebounds +
        line.assists +
        (ts !== null && ts >= 65 ? 10 : 0),
    });
  }

  if (line.points >= 40) {
    const tier: FullCourtNotableMomentTier = line.points >= 50 ? 'historic' : 'standout';
    const headline =
      line.points >= 60
        ? '60-Point Masterpiece'
        : line.points >= 50
          ? '50-Point Explosion'
          : ts !== null && ts >= 70
            ? '40-Point Efficiency Clinic'
            : '40-Point Night';
    candidates.push({
      category: 'scoring',
      tier,
      headline,
      statLine: statLineFromBox(line, {
        includeTs: ts !== null && ts >= 62,
        includeThrees: line.tpm >= 6,
      }),
      rankScore:
        (line.points >= 60 ? 180 : line.points >= 50 ? 150 : 105) +
        line.points +
        (ts !== null && ts >= 68 ? 10 : 0),
    });
  }

  if (line.tpm >= 8 && threePct >= 0.42) {
    candidates.push({
      category: 'scoring',
      tier: line.tpm >= 10 ? 'historic' : 'standout',
      headline: line.tpm >= 10 ? `${String(line.tpm)}-Three Barrage` : 'Lights-Out From Deep',
      statLine: statLineFromBox(line, { includeThrees: true, includeTs: true }),
      rankScore: 102 + line.tpm * 5 + line.points * 0.4,
    });
  }

  if (
    (ts !== null && line.points >= 30 && ts >= 72) ||
    (ts !== null && line.points >= 25 && ts >= 76) ||
    (line.fga >= 8 && line.fgm === line.fga && line.points >= 18)
  ) {
    const perfectFg = line.fga >= 8 && line.fgm === line.fga;
    const tier: FullCourtNotableMomentTier =
      (ts !== null && line.points >= 32 && ts >= 75) || (line.fga >= 10 && line.fgm === line.fga)
        ? 'standout'
        : 'notable';
    candidates.push({
      category: 'efficiency',
      tier,
      headline: perfectFg ? 'Perfect From the Field' : 'Scoring Efficiency Clinic',
      statLine: statLineFromBox(line, { includeShooting: true, includeTs: true }),
      rankScore:
        86 +
        line.points +
        (ts !== null ? Math.min(25, Math.max(0, ts - 65) * 1.2) : 0) +
        (perfectFg ? 15 : 0),
    });
  }

  if (line.assists >= 15 || (line.assists >= 12 && line.turnovers <= 1)) {
    const tier: FullCourtNotableMomentTier =
      line.assists >= 18 ? 'historic' : line.assists >= 15 ? 'standout' : 'notable';
    candidates.push({
      category: 'playmaking',
      tier,
      headline:
        line.assists >= 18
          ? 'Playmaking Masterclass'
          : line.assists >= 15
            ? '15+ Assist Night'
            : 'Zero-Waste Floor General',
      statLine: statLineFromBox(line, {
        includeTurnovers: line.turnovers <= 2,
        includeTs: ts !== null && ts >= 64,
      }),
      rankScore: 92 + line.assists * 3 + (line.turnovers === 0 ? 10 : 0),
    });
  }

  if ((line.points >= 20 && line.rebounds >= 20) || line.rebounds >= 22) {
    const twentyTwenty = line.points >= 20 && line.rebounds >= 20;
    candidates.push({
      category: 'defense-glass',
      tier: twentyTwenty || line.rebounds >= 25 ? 'historic' : 'standout',
      headline: twentyTwenty ? '20-20 Dominance' : 'Glass Dominance',
      statLine: statLineFromBox(line, { includeShooting: true }),
      rankScore: (twentyTwenty ? 135 : 95) + line.rebounds * 1.5 + line.points * 0.6,
    });
  }

  if (line.blocks >= 6 || line.steals >= 6 || stocks >= 10) {
    candidates.push({
      category: 'defense-glass',
      tier: line.blocks >= 8 || line.steals >= 8 || stocks >= 12 ? 'historic' : 'standout',
      headline: 'Defensive Takeover',
      statLine: statLineFromBox(line, { includeStocks: true }),
      rankScore: 90 + stocks * 6 + line.points * 0.4,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.rankScore - left.rankScore);
  return candidates[0] ?? null;
}

function toPlayerGameStats(player: FullCourtPlayerLine): FullCourtPlayerGameStats {
  return {
    playerId: player.playerId,
    started: player.startedGame,
    seconds: player.seconds,
    points: player.points,
    rebounds: player.rebounds.total,
    offRebounds: player.rebounds.offensive,
    defRebounds: player.rebounds.defensive,
    assists: player.assists,
    steals: player.steals,
    blocks: player.blocks,
    turnovers: player.turnovers,
    fouls: player.fouls,
    fgm: player.fieldGoals.made,
    fga: player.fieldGoals.attempted,
    tpm: player.threes.made,
    tpa: player.threes.attempted,
    ftm: player.freeThrows.made,
    fta: player.freeThrows.attempted,
  };
}

function scoreLabelForSide(homePoints: number, awayPoints: number, side: 'home' | 'away'): string {
  const teamPts = side === 'home' ? homePoints : awayPoints;
  const oppPts = side === 'home' ? awayPoints : homePoints;
  return `${teamPts > oppPts ? 'W' : 'L'} ${String(teamPts)}–${String(oppPts)}`;
}

function gameMomentsFromOutcome(input: {
  readonly gameId: string;
  readonly phase: 'regular' | 'playoffs';
  readonly gameNumber: number;
  readonly gameLabel: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeName: string;
  readonly awayName: string;
  readonly userTeamId: string;
  readonly outcome: FullCourtSeasonScore['outcome'];
  readonly playerNames: ReadonlyMap<string, string>;
}): FullCourtNotableMoment[] {
  const { outcome } = input;
  if (outcome.kind !== 'played') return [];

  const userInvolved =
    input.homeTeamId === input.userTeamId || input.awayTeamId === input.userTeamId;
  const winnerSide: 'home' | 'away' = outcome.homePoints > outcome.awayPoints ? 'home' : 'away';
  const collected: FullCourtNotableMoment[] = [];

  if (outcome.playerStats !== undefined) {
    for (const side of ['home', 'away'] as const) {
      const teamId = side === 'home' ? input.homeTeamId : input.awayTeamId;
      const teamName = side === 'home' ? input.homeName : input.awayName;
      const opponentTeamId = side === 'home' ? input.awayTeamId : input.homeTeamId;
      const opponentTeamName = side === 'home' ? input.awayName : input.homeName;
      const won = side === winnerSide;
      const scoreLabel = scoreLabelForSide(outcome.homePoints, outcome.awayPoints, side);

      for (const line of outcome.playerStats[side]) {
        const feat = evaluatePlayerMoment(line);
        if (feat === null) continue;
        collected.push({
          id: `${input.gameId}:${teamId}:${line.playerId}`,
          gameId: input.gameId,
          phase: input.phase,
          gameNumber: input.gameNumber,
          gameLabel: input.gameLabel,
          teamId,
          teamName,
          opponentTeamId,
          opponentTeamName,
          userInvolved,
          isUserPlayerOrTeam: teamId === input.userTeamId,
          playerId: line.playerId,
          playerName: input.playerNames.get(line.playerId) ?? line.playerId,
          category: feat.category,
          tier: feat.tier,
          headline: feat.headline,
          statLine: feat.statLine,
          scoreLabel,
          won,
          rankScore: feat.rankScore,
        });
      }
    }
  }

  if (collected.length === 0) {
    for (const side of ['home', 'away'] as const) {
      const benchPts = outcome.benchPoints?.[side];
      if (benchPts !== undefined && benchPts >= 50) {
        const teamId = side === 'home' ? input.homeTeamId : input.awayTeamId;
        const teamName = side === 'home' ? input.homeName : input.awayName;
        const opponentTeamId = side === 'home' ? input.awayTeamId : input.homeTeamId;
        const opponentTeamName = side === 'home' ? input.awayName : input.homeName;
        const benchCount = outcome.benchPlayers?.[side] ?? 0;
        collected.push({
          id: `${input.gameId}:${teamId}:bench`,
          gameId: input.gameId,
          phase: input.phase,
          gameNumber: input.gameNumber,
          gameLabel: input.gameLabel,
          teamId,
          teamName,
          opponentTeamId,
          opponentTeamName,
          userInvolved,
          isUserPlayerOrTeam: teamId === input.userTeamId,
          playerId: null,
          playerName: null,
          category: 'team-game',
          tier: benchPts >= 60 ? 'standout' : 'notable',
          headline: 'Bench Eruption',
          statLine:
            benchCount > 0
              ? `${String(benchPts)} bench PTS (${String(benchCount)} reserves)`
              : `${String(benchPts)} bench PTS`,
          scoreLabel: scoreLabelForSide(outcome.homePoints, outcome.awayPoints, side),
          won: side === winnerSide,
          rankScore: 65 + benchPts * 0.5,
        });
      }
    }
  }

  if (collected.length === 0 && Math.abs(outcome.homePoints - outcome.awayPoints) === 1) {
    const winTeamId = winnerSide === 'home' ? input.homeTeamId : input.awayTeamId;
    const winTeamName = winnerSide === 'home' ? input.homeName : input.awayName;
    const loseTeamId = winnerSide === 'home' ? input.awayTeamId : input.homeTeamId;
    const loseTeamName = winnerSide === 'home' ? input.awayName : input.homeName;
    const focusUser =
      userInvolved && (winTeamId === input.userTeamId || loseTeamId === input.userTeamId);
    const focusSide = focusUser
      ? input.homeTeamId === input.userTeamId
        ? 'home'
        : 'away'
      : winnerSide;
    collected.push({
      id: `${input.gameId}:thriller`,
      gameId: input.gameId,
      phase: input.phase,
      gameNumber: input.gameNumber,
      gameLabel: input.gameLabel,
      teamId: focusUser ? input.userTeamId : winTeamId,
      teamName: focusUser ? (focusSide === 'home' ? input.homeName : input.awayName) : winTeamName,
      opponentTeamId: focusUser
        ? focusSide === 'home'
          ? input.awayTeamId
          : input.homeTeamId
        : loseTeamId,
      opponentTeamName: focusUser
        ? focusSide === 'home'
          ? input.awayName
          : input.homeName
        : loseTeamName,
      userInvolved,
      isUserPlayerOrTeam: focusUser ? focusSide === winnerSide : false,
      playerId: null,
      playerName: null,
      category: 'team-game',
      tier: 'notable',
      headline: 'One-Point Thriller',
      statLine: `${winTeamName} ${String(Math.max(outcome.homePoints, outcome.awayPoints))}–${String(Math.min(outcome.homePoints, outcome.awayPoints))}`,
      scoreLabel: scoreLabelForSide(outcome.homePoints, outcome.awayPoints, focusSide),
      won: focusUser ? focusSide === winnerSide : true,
      rankScore: 70,
    });
  }

  collected.sort(
    (left, right) =>
      right.rankScore - left.rankScore ||
      Number(right.isUserPlayerOrTeam) - Number(left.isUserPlayerOrTeam) ||
      left.id.localeCompare(right.id),
  );
  return collected.slice(0, MAX_MOMENTS_PER_GAME);
}

/**
 * Extracts up to two notable moments directly from a full Gamecast game result.
 */
export function fullCourtGameMomentsFromResult(input: {
  readonly result: FullCourtGameResult;
  readonly userTeamId: string;
  readonly gameId?: string;
  readonly phase?: 'regular' | 'playoffs';
  readonly gameNumber?: number;
  readonly gameLabel?: string;
}): readonly FullCourtNotableMoment[] {
  const { result } = input;
  const playerNames = new Map<string, string>();
  for (const player of [...result.home.players, ...result.away.players]) {
    playerNames.set(player.playerId, player.displayName);
  }
  const homeBench = result.home.players.reduce(
    (sum, player) => sum + (player.startedGame ? 0 : player.points),
    0,
  );
  const awayBench = result.away.players.reduce(
    (sum, player) => sum + (player.startedGame ? 0 : player.points),
    0,
  );
  return gameMomentsFromOutcome({
    gameId: input.gameId ?? result.seed,
    phase: input.phase ?? 'regular',
    gameNumber: input.gameNumber ?? result.gameNumber,
    gameLabel: input.gameLabel ?? `Game ${String(input.gameNumber ?? result.gameNumber)}`,
    homeTeamId: result.home.teamId,
    awayTeamId: result.away.teamId,
    homeName: result.home.displayName,
    awayName: result.away.displayName,
    userTeamId: input.userTeamId,
    playerNames,
    outcome: {
      kind: 'played',
      homePoints: result.home.box.points,
      awayPoints: result.away.box.points,
      benchPoints: { home: homeBench, away: awayBench },
      benchPlayers: {
        home: result.home.players.filter((p) => !p.startedGame && p.seconds > 0).length,
        away: result.away.players.filter((p) => !p.startedGame && p.seconds > 0).length,
      },
      playerStats: {
        home: result.home.players
          .filter((player) => player.seconds > 0 || player.points !== 0)
          .map(toPlayerGameStats),
        away: result.away.players
          .filter((player) => player.seconds > 0 || player.points !== 0)
          .map(toPlayerGameStats),
      },
    },
  });
}

function playoffGameLabel(round: number, ordinal: number): string {
  if (round === 4) return `Finals G${String(ordinal)}`;
  const prefix =
    round === 1
      ? 'R1'
      : round === 2
        ? 'Conf Semis'
        : round === 3
          ? 'Conf Finals'
          : capRushConferenceRoundName(round);
  return `${prefix} G${String(ordinal)}`;
}

/**
 * Derives ranked notable moments across saved regular-season and playoff games
 * without re-simulating or mutating saved score contracts.
 */
export function buildFullCourtNotableMoments(input: {
  readonly teams: readonly FullCourtMomentsTeamInput[];
  readonly userTeamId: string;
  readonly regularScores: readonly FullCourtSeasonScore[];
  readonly series?: readonly FullCourtPlayoffSeries[];
  readonly leagueLimit?: number;
}): FullCourtNotableMomentsSummary {
  const teamNames = new Map<string, string>();
  const playerNames = new Map<string, string>();
  for (const team of input.teams) {
    teamNames.set(team.teamId, team.displayName);
    for (const player of team.roster) {
      playerNames.set(player.playerId, player.displayName);
    }
  }

  const allMoments: FullCourtNotableMoment[] = [];
  const byGameId = new Map<string, readonly FullCourtNotableMoment[]>();

  for (const score of input.regularScores) {
    const moments = gameMomentsFromOutcome({
      gameId: score.gameId,
      phase: 'regular',
      gameNumber: score.slot,
      gameLabel: `Game ${String(score.slot)}`,
      homeTeamId: score.homeTeamId,
      awayTeamId: score.awayTeamId,
      homeName: teamNames.get(score.homeTeamId) ?? score.homeTeamId,
      awayName: teamNames.get(score.awayTeamId) ?? score.awayTeamId,
      userTeamId: input.userTeamId,
      outcome: score.outcome,
      playerNames,
    });
    if (moments.length > 0) {
      byGameId.set(score.gameId, moments);
      allMoments.push(...moments);
    }
  }

  for (const series of input.series ?? []) {
    series.games.forEach((game: FullCourtPlayoffScore, index: number) => {
      const ordinal = index + 1;
      const moments = gameMomentsFromOutcome({
        gameId: game.gameId,
        phase: 'playoffs',
        gameNumber: ordinal,
        gameLabel: playoffGameLabel(series.round, ordinal),
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeName: teamNames.get(game.homeTeamId) ?? game.homeTeamId,
        awayName: teamNames.get(game.awayTeamId) ?? game.awayTeamId,
        userTeamId: input.userTeamId,
        outcome: game.outcome,
        playerNames,
      });
      if (moments.length > 0) {
        byGameId.set(game.gameId, moments);
        allMoments.push(...moments);
      }
    });
  }

  const sortMoments = (left: FullCourtNotableMoment, right: FullCourtNotableMoment): number =>
    right.rankScore - left.rankScore ||
    Number(right.phase === 'playoffs') - Number(left.phase === 'playoffs') ||
    right.gameNumber - left.gameNumber ||
    left.id.localeCompare(right.id);

  const userMoments = allMoments.filter((moment) => moment.userInvolved).sort(sortMoments);
  const leagueMoments = [...allMoments]
    .sort(sortMoments)
    .slice(0, input.leagueLimit ?? DEFAULT_LEAGUE_MOMENTS_LIMIT);

  return {
    userMoments,
    leagueMoments,
    byGameId,
  };
}
