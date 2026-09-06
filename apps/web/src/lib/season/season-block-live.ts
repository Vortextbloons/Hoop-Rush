import { seasonBlockGamesOf } from '@hoop-rush/engine';
import type { SeasonSchedule, SeasonScoreline } from '@hoop-rush/data-contracts';

export interface BlockLiveProgressInput {
  gamesCompleted: number;
  gamesTotal: number;
  latestGameId: string | null;
  latestResult: SeasonScoreline | null;
  isHumanGame: boolean;
  humanRecordInBlock: { wins: number; losses: number };
  humanResults: SeasonScoreline[];
  leaguePulse: {
    closest: SeasonScoreline | null;
    blowout: SeasonScoreline | null;
    highestScoring: SeasonScoreline | null;
  };
}

export interface BlockLiveSlot {
  gameId: string;
  round: number;
  opponentFranchiseId: string;
  opponentName: string;
  isHome: boolean;
  status: 'final' | 'upcoming';
  result: SeasonScoreline | null;
  humanWon: boolean | null;
}

export interface BlockLiveTicker {
  kind: 'human' | 'league' | 'empty';
  scoreline: SeasonScoreline | null;
  nextOpponentFranchiseId: string | null;
  nextOpponentGameId: string | null;
  nextOpponentName: string | null;
  leagueCompleted: number;
  leagueTotal: number;
  humanCompleted: number;
  humanTotal: number;
}

export interface BlockLiveRoundCompletion {
  round: number;
  completed: number;
  total: number;
}

export interface BlockLiveNextOpponent {
  franchiseId: string | null;
  gameId: string | null;
  round: number | null;
  name: string | null;
}

export interface BlockLiveViewModel {
  slots: BlockLiveSlot[];
  humanResults: SeasonScoreline[];
  ticker: BlockLiveTicker;
  pulse: {
    closest: SeasonScoreline | null;
    blowout: SeasonScoreline | null;
    highestScoring: SeasonScoreline | null;
  };
  roundCompletion: BlockLiveRoundCompletion[];
  nextOpponent: BlockLiveNextOpponent;
}

export function buildBlockLiveViewModel(input: {
  schedule: SeasonSchedule;
  blockIndex: number;
  humanFranchiseId: string | null;
  progress: BlockLiveProgressInput | null;
  franchiseNameOf?: (franchiseId: string) => string;
}): BlockLiveViewModel {
  const nameOf = input.franchiseNameOf ?? ((id: string) => id);
  const games = seasonBlockGamesOf(input.schedule, input.blockIndex);
  const humanGames =
    input.humanFranchiseId === null
      ? []
      : games.filter(
          (game) =>
            game.homeFranchiseId === input.humanFranchiseId ||
            game.awayFranchiseId === input.humanFranchiseId,
        );
  const progress = input.progress;
  const humanResults = progress !== null ? [...progress.humanResults] : [];
  const resultByGameId = new Map(humanResults.map((line) => [line.gameId, line]));
  const slots: BlockLiveSlot[] = humanGames.map((game) => {
    const isHome = game.homeFranchiseId === input.humanFranchiseId;
    const opponentFranchiseId = isHome ? game.awayFranchiseId : game.homeFranchiseId;
    const result = resultByGameId.get(game.gameId) ?? null;
    let humanWon: boolean | null = null;
    if (result !== null && input.humanFranchiseId !== null) {
      const humanScore = isHome ? result.homeScore : result.awayScore;
      const oppScore = isHome ? result.awayScore : result.homeScore;
      humanWon = humanScore > oppScore;
    }
    return {
      gameId: game.gameId,
      round: game.round,
      opponentFranchiseId,
      opponentName: nameOf(opponentFranchiseId),
      isHome,
      status: result !== null ? 'final' : 'upcoming',
      result,
      humanWon,
    };
  });
  const pulse = progress?.leaguePulse ?? { closest: null, blowout: null, highestScoring: null };
  const rounds = [...new Set(games.map((game) => game.round))].sort((a, b) => a - b);
  const completedCount = progress?.gamesCompleted ?? 0;
  const roundCompletion: BlockLiveRoundCompletion[] = rounds.map((round) => {
    const inRound = games
      .map((game, index) => ({ game, index }))
      .filter(({ game }) => game.round === round);
    const total = inRound.length;
    const completed = inRound.filter(({ index }) => index < completedCount).length;
    return { round, completed, total };
  });
  const latestHuman =
    humanResults.length > 0 ? (humanResults[humanResults.length - 1] ?? null) : null;
  const latestLeague = progress?.latestResult ?? null;
  const kind: BlockLiveTicker['kind'] =
    latestHuman !== null ? 'human' : latestLeague !== null ? 'league' : 'empty';
  const scoreline = latestHuman ?? latestLeague;
  const nextSlot = slots.find((slot) => slot.status === 'upcoming') ?? null;
  const nextOpponent: BlockLiveNextOpponent =
    nextSlot === null
      ? { franchiseId: null, gameId: null, round: null, name: null }
      : {
          franchiseId: nextSlot.opponentFranchiseId,
          gameId: nextSlot.gameId,
          round: nextSlot.round,
          name: nextSlot.opponentName,
        };
  const ticker: BlockLiveTicker = {
    kind,
    scoreline,
    nextOpponentFranchiseId: nextOpponent.franchiseId,
    nextOpponentGameId: nextOpponent.gameId,
    nextOpponentName: nextOpponent.name,
    leagueCompleted: progress?.gamesCompleted ?? 0,
    leagueTotal: progress?.gamesTotal ?? games.length,
    humanCompleted: humanResults.length,
    humanTotal: humanGames.length,
  };
  return {
    slots,
    humanResults,
    ticker,
    pulse: {
      closest: pulse.closest,
      blowout: pulse.blowout,
      highestScoring: pulse.highestScoring,
    },
    roundCompletion,
    nextOpponent,
  };
}
